/**
 * Offline-first pickup submission queue.
 *
 * Loading docks kill connectivity: when completePickup() fails on a NETWORK
 * error, the full submission (manifest + evidence Blobs) is persisted to
 * IndexedDB and replayed when the browser comes back online.
 *
 * Replay is idempotent end-to-end:
 *   • storage uploads use upsert:false — an "already exists" error on retry
 *     means the previous attempt got through; treated as success
 *   • the ledger insert reuses the queued logical_id — a duplicate-key error
 *     (23505 on logical_id+revision) resolves to the existing event id
 *   • assignment completion is an UPDATE keyed by assignment id — idempotent
 */

import { supabase } from '../supabase';
import { createPickupEvent } from '../api/pickups';
import { uploadSignature, uploadPhoto, uploadReceipt } from '../api/storage';
import { completeAssignment } from '../api/assignments';
import type { EvidenceUploadResult } from '../api/storage';

const DB_NAME = 'sanad360-pickup-queue';
const DB_VERSION = 1;
const STORE = 'submissions';

export interface QueuedSubmission {
  /** Client-generated UUID — used as ledger logical_id AND storage path segment. */
  eventId: string;
  assignmentId: string;
  companyId: string;
  branchId: string;
  transportCompanyId: string;
  driverId: string;
  vehicleId: string;
  wasteTypes: string[];
  weightKg: number;
  gpsLat?: number;
  gpsLng?: number;
  gpsAccuracyM?: number;
  qrCodeValue?: string;
  /** Signature as base64 data URL (canvas output). */
  signatureDataUrl?: string;
  /** Blobs persist natively in IndexedDB; names/types kept to rebuild Files. */
  photoBlob?: Blob;
  photoName?: string;
  photoType?: string;
  receiptBlob?: Blob;
  receiptName?: string;
  receiptType?: string;
  queuedAt: number;
  attempts: number;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE, { keyPath: 'eventId' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const req = run(t.objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
        t.oncomplete = () => db.close();
      })
  );
}

export function enqueueSubmission(sub: QueuedSubmission): Promise<IDBValidKey> {
  return tx('readwrite', (s) => s.put(sub));
}

export function listQueued(): Promise<QueuedSubmission[]> {
  return tx('readonly', (s) => s.getAll() as IDBRequest<QueuedSubmission[]>);
}

export function removeQueued(eventId: string): Promise<undefined> {
  return tx('readwrite', (s) => s.delete(eventId) as IDBRequest<undefined>);
}

export function queuedCount(): Promise<number> {
  return tx('readonly', (s) => s.count());
}

/** Heuristic: was this failure caused by connectivity rather than the server
 *  rejecting the data? Only network failures are queued — a real rejection
 *  (RLS, validation, trigger) must surface to the driver immediately. */
export function isNetworkError(err: unknown): boolean {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return true;
  const msg = err instanceof Error ? err.message : String(err);
  return /failed to fetch|fetch failed|networkerror|load failed|network request failed/i.test(msg);
}

/** "Object already exists" from a retried upsert:false upload = prior attempt landed. */
function isAlreadyExists(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /already exists|duplicate/i.test(msg);
}

/** Replay one queued submission. Throws on (non-duplicate) failure. */
async function replay(sub: QueuedSubmission): Promise<void> {
  // Rebuild evidence upload results deterministically from the stored bytes so
  // the hashes recorded on the ledger row match the uploaded files.
  let signatureRes: EvidenceUploadResult | undefined;
  let photoRes: EvidenceUploadResult | undefined;
  let receiptRes: EvidenceUploadResult | undefined;

  if (sub.signatureDataUrl) {
    try {
      signatureRes = await uploadSignature(sub.companyId, sub.branchId, sub.eventId, sub.signatureDataUrl);
    } catch (err) {
      if (!isAlreadyExists(err)) throw err;
      // Path is deterministic; recompute the result locally.
      const blob = await (await fetch(sub.signatureDataUrl)).blob();
      const { computeSha256 } = await import('../api/storage');
      signatureRes = {
        path: `${sub.companyId}/${sub.branchId}/${sub.eventId}/signature.png`,
        sha256: await computeSha256(new Uint8Array(await blob.arrayBuffer())),
      };
    }
  }
  if (sub.photoBlob) {
    const file = new File([sub.photoBlob], sub.photoName ?? 'photo.jpg', {
      type: sub.photoType ?? 'image/jpeg',
    });
    try {
      photoRes = await uploadPhoto(sub.companyId, sub.branchId, sub.eventId, file);
    } catch (err) {
      if (!isAlreadyExists(err)) throw err;
      const { computeSha256 } = await import('../api/storage');
      const ext = file.name.split('.').pop() ?? 'jpg';
      photoRes = {
        path: `${sub.companyId}/${sub.branchId}/${sub.eventId}/photo.${ext}`,
        sha256: await computeSha256(new Uint8Array(await file.arrayBuffer())),
      };
    }
  }
  if (sub.receiptBlob) {
    const file = new File([sub.receiptBlob], sub.receiptName ?? 'receipt.pdf', {
      type: sub.receiptType ?? 'application/pdf',
    });
    try {
      receiptRes = await uploadReceipt(sub.companyId, sub.branchId, sub.eventId, file);
    } catch (err) {
      if (!isAlreadyExists(err)) throw err;
      const { computeSha256 } = await import('../api/storage');
      const ext = file.name.split('.').pop() ?? 'pdf';
      receiptRes = {
        path: `${sub.companyId}/${sub.branchId}/${sub.eventId}/receipt.${ext}`,
        sha256: await computeSha256(new Uint8Array(await file.arrayBuffer())),
      };
    }
  }

  // Ledger append — duplicate logical_id means a prior attempt succeeded.
  let ledgerEventId: string;
  try {
    const event = await createPickupEvent({
      logical_id: sub.eventId,
      company_id: sub.companyId,
      branch_id: sub.branchId,
      transport_company_id: sub.transportCompanyId,
      driver_id: sub.driverId,
      vehicle_id: sub.vehicleId,
      waste_types: sub.wasteTypes,
      weight_kg: sub.weightKg,
      gps_lat: sub.gpsLat,
      gps_lng: sub.gpsLng,
      gps_accuracy_m: sub.gpsAccuracyM,
      qr_code_value: sub.qrCodeValue,
      photo_path: photoRes?.path,
      receipt_path: receiptRes?.path,
      signature_path: signatureRes?.path,
      photo_sha256: photoRes?.sha256,
      receipt_sha256: receiptRes?.sha256,
      signature_sha256: signatureRes?.sha256,
    });
    ledgerEventId = event.id;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!/duplicate key|23505/i.test(msg)) throw err;
    const { data, error } = await supabase
      .from('pickup_events')
      .select('id')
      .eq('logical_id', sub.eventId)
      .eq('revision', 1)
      .single<{ id: string }>();
    if (error) throw error;
    ledgerEventId = data.id;
  }

  await completeAssignment(sub.assignmentId, ledgerEventId);
}

export interface DrainResult {
  synced: number;
  failed: number;
}

let draining = false;

/** Replay everything in the queue. Safe to call repeatedly (re-entrancy guarded). */
export async function drainQueue(): Promise<DrainResult> {
  if (draining) return { synced: 0, failed: 0 };
  draining = true;
  const result: DrainResult = { synced: 0, failed: 0 };
  try {
    const items = await listQueued();
    for (const item of items) {
      try {
        await replay(item);
        await removeQueued(item.eventId);
        result.synced++;
      } catch (err) {
        // Still offline (or a real rejection) — keep it queued, bump attempts.
        result.failed++;
        await enqueueSubmission({ ...item, attempts: item.attempts + 1 });
        if (isNetworkError(err)) break; // no point hammering the rest
      }
    }
  } finally {
    draining = false;
  }
  return result;
}

/**
 * Install the sync triggers: replay on app start (if anything is queued) and
 * whenever connectivity returns. Returns an unsubscribe function.
 */
export function initPickupQueueSync(onSynced?: (r: DrainResult) => void): () => void {
  const run = async () => {
    if ((await queuedCount()) === 0) return;
    const r = await drainQueue();
    if (r.synced > 0 && onSynced) onSynced(r);
  };
  const onlineHandler = () => { void run(); };
  window.addEventListener('online', onlineHandler);
  void run();
  return () => window.removeEventListener('online', onlineHandler);
}
