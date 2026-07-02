import { supabase } from '../supabase';
import type { PickupEvent } from '../database.types';

/**
 * Flagged-records review queue (manager view).
 *
 * A pickup event needs attention when the server-side risk engine raised any
 * flag OR its chain of custody is still open (no disposal confirmation).
 * Everything here reads through RLS-scoped views/tables — no service role.
 */

export type ReviewReason =
  | 'missing_photo'
  | 'missing_signature'
  | 'geofence_failed'
  | 'gps_low_accuracy'
  | 'qr_mismatch'
  | 'weight_anomaly'
  | 'driver_license_expiring'
  | 'vehicle_license_expiring'
  | 'custody_missing';

export interface FlaggedRecord {
  event: PickupEvent;
  reasons: ReviewReason[];
  custodyConfirmed: boolean;
  /** True when a manager already acknowledged this record. */
  reviewed: boolean;
}

const REVIEW_KEY_PREFIX = 'pickup_review:';

/**
 * List records needing review: latest revision per pickup, flagged by the risk
 * engine or missing their disposal confirmation. Acknowledged records are
 * included with reviewed=true so the UI can filter without losing history.
 */
export async function listFlaggedPickups(limit = 200): Promise<FlaggedRecord[]> {
  const { data: events, error } = await supabase
    .from('pickup_events_latest')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;

  const rows = (events as PickupEvent[]) ?? [];
  if (rows.length === 0) return [];

  const ids = rows.map((e) => e.id);
  const [{ data: confirmations, error: confErr }, { data: acks, error: ackErr }] =
    await Promise.all([
      supabase.from('disposal_confirmations').select('pickup_event_id').in('pickup_event_id', ids),
      supabase
        .from('alert_acknowledgements')
        .select('alert_key')
        .in('alert_key', ids.map((id) => `${REVIEW_KEY_PREFIX}${id}`)),
    ]);
  if (confErr) throw confErr;
  if (ackErr) throw ackErr;

  const confirmed = new Set(
    ((confirmations as { pickup_event_id: string }[]) ?? []).map((c) => c.pickup_event_id)
  );
  const acked = new Set(
    ((acks as { alert_key: string }[]) ?? []).map((a) => a.alert_key.slice(REVIEW_KEY_PREFIX.length))
  );

  return rows
    .map((event) => {
      const reasons = [...event.risk_flags] as ReviewReason[];
      const custodyConfirmed = confirmed.has(event.id);
      if (!custodyConfirmed) reasons.push('custody_missing');
      return { event, reasons, custodyConfirmed, reviewed: acked.has(event.id) };
    })
    .filter((r) => r.reasons.length > 0);
}

/**
 * Mark a flagged record as reviewed (idempotent: re-acknowledging an already
 * acknowledged record is a no-op thanks to the (company_id, alert_key) UNIQUE).
 */
export async function acknowledgePickupReview(
  companyId: string,
  pickupEventId: string,
  acknowledgedBy: string
): Promise<void> {
  const { error } = await supabase.from('alert_acknowledgements').insert({
    company_id: companyId,
    alert_key: `${REVIEW_KEY_PREFIX}${pickupEventId}`,
    acknowledged_by: acknowledgedBy,
  });
  // 23505 = already acknowledged — treat as success.
  if (error && error.code !== '23505') throw error;
}
