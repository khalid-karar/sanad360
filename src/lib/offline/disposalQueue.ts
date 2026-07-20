/**
 * Offline-first disposal confirmations (CP1 rework).
 *
 * The disposal leg happens at the receiving facility's weighbridge — the
 * scale_operator's confirmation, not the driver's. Facilities sit on the
 * city edge (worse connectivity than the curb pickup), so this mirrors
 * pickupQueue: on NETWORK failure the full confirmation (fields + the
 * weighbridge photo Blob) persists to IndexedDB and replays when
 * connectivity returns.
 *
 * Idempotent replay:
 *   • weighbridge photo upload uses upsert:false — "already exists" on retry
 *     = the previous attempt landed; continue to the row insert
 *   • the row insert hits UNIQUE(trip_id) if a prior attempt already
 *     succeeded — 23505 is treated as success
 */

import { createDisposalConfirmation } from '../api/disposals';
import { isNetworkError } from './pickupQueue';

const DB_NAME = 'sanad360-disposal-queue';
const DB_VERSION = 1;
const STORE = 'confirmations';

export interface QueuedDisposal {
  /** trip id — natural key; UNIQUE(trip_id) server-side gives idempotency. */
  tripId: string;
  facilityId: string;
  status: 'confirmed' | 'rejected';
  rejectReason?: string;
  netWeightKg?: number;
  gpsLat?: number;
  gpsLng?: number;
  notes?: string;
  photoBlob?: Blob;
  photoName?: string;
  photoType?: string;
  queuedAt: number;
  attempts: number;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE, { keyPath: 'tripId' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
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

export function enqueueDisposal(d: QueuedDisposal): Promise<IDBValidKey> {
  return tx('readwrite', (s) => s.put(d));
}

export function listQueuedDisposals(): Promise<QueuedDisposal[]> {
  return tx('readonly', (s) => s.getAll() as IDBRequest<QueuedDisposal[]>);
}

export function removeQueuedDisposal(tripId: string): Promise<undefined> {
  return tx('readwrite', (s) => s.delete(tripId) as IDBRequest<undefined>);
}

export function queuedDisposalCount(): Promise<number> {
  return tx('readonly', (s) => s.count());
}

/** Duplicate confirmation (prior attempt landed) = success. */
function isDuplicate(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  const code = (err as { code?: string } | null)?.code;
  return code === '23505' || /duplicate key|already exists/i.test(msg);
}

async function replay(d: QueuedDisposal): Promise<void> {
  const photoFile = d.photoBlob
    ? new File([d.photoBlob], d.photoName ?? 'weighbridge.jpg', { type: d.photoType ?? 'image/jpeg' })
    : undefined;
  try {
    await createDisposalConfirmation(
      { id: d.tripId, planned_facility_id: d.facilityId },
      {
        status: d.status,
        reject_reason: d.rejectReason,
        net_weight_kg: d.netWeightKg,
        gps_lat: d.gpsLat,
        gps_lng: d.gpsLng,
        notes: d.notes,
      },
      photoFile
    );
  } catch (err) {
    if (!isDuplicate(err)) throw err;
  }
}

export interface DisposalDrainResult {
  synced: number;
  failed: number;
}

let draining = false;

/** Replay everything queued. Re-entrancy guarded; stops on network failure. */
export async function drainDisposalQueue(): Promise<DisposalDrainResult> {
  if (draining) return { synced: 0, failed: 0 };
  draining = true;
  const result: DisposalDrainResult = { synced: 0, failed: 0 };
  try {
    const items = await listQueuedDisposals();
    for (const item of items) {
      try {
        await replay(item);
        await removeQueuedDisposal(item.tripId);
        result.synced++;
      } catch (err) {
        result.failed++;
        await enqueueDisposal({ ...item, attempts: item.attempts + 1 });
        if (isNetworkError(err)) break;
      }
    }
  } finally {
    draining = false;
  }
  return result;
}

/** Sync triggers: replay on app start + on connectivity return. */
export function initDisposalQueueSync(onSynced?: (r: DisposalDrainResult) => void): () => void {
  const run = async () => {
    if ((await queuedDisposalCount()) === 0) return;
    const r = await drainDisposalQueue();
    if (r.synced > 0 && onSynced) onSynced(r);
  };
  const handler = () => { void run(); };
  window.addEventListener('online', handler);
  void run();
  return () => window.removeEventListener('online', handler);
}
