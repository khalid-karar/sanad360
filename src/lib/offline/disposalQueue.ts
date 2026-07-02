/**
 * Offline-first disposal confirmations (launch-critical item 2).
 *
 * The disposal leg happens at treatment facilities on the city edge — WORSE
 * connectivity than the pickup. Mirrors pickupQueue: on NETWORK failure the
 * full confirmation (fields + weighbridge-ticket Blob) persists to IndexedDB
 * and replays when connectivity returns.
 *
 * Idempotent replay:
 *   • ticket upload uses upsert:false — "already exists" on retry = the
 *     previous attempt landed; recompute the hash locally and continue
 *   • the row insert hits UNIQUE(pickup_event_id) if a prior attempt
 *     succeeded — 23505 is treated as success
 */

import { createDisposalConfirmation } from '../api/disposals';
import { isNetworkError } from './pickupQueue';

const DB_NAME = 'sanad360-disposal-queue';
const DB_VERSION = 1;
const STORE = 'confirmations';

export interface QueuedDisposal {
  /** pickup event id — natural key; UNIQUE server-side gives idempotency. */
  eventId: string;
  companyId: string;
  branchId: string;
  facilityNameAr: string;
  facilityLicense?: string;
  gpsLat?: number;
  gpsLng?: number;
  notes?: string;
  ticketBlob?: Blob;
  ticketName?: string;
  ticketType?: string;
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

export function removeQueuedDisposal(eventId: string): Promise<undefined> {
  return tx('readwrite', (s) => s.delete(eventId) as IDBRequest<undefined>);
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
  const ticketFile = d.ticketBlob
    ? new File([d.ticketBlob], d.ticketName ?? 'ticket.jpg', { type: d.ticketType ?? 'image/jpeg' })
    : undefined;
  try {
    await createDisposalConfirmation(
      { id: d.eventId, company_id: d.companyId, branch_id: d.branchId },
      {
        facility_name_ar: d.facilityNameAr,
        facility_license_number: d.facilityLicense,
        gps_lat: d.gpsLat,
        gps_lng: d.gpsLng,
        notes: d.notes,
      },
      ticketFile
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
        await removeQueuedDisposal(item.eventId);
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
