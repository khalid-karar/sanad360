import { supabase } from '../supabase';
import type { PickupEvent } from '../database.types';

/**
 * Flagged-records review queue (manager view).
 *
 * A pickup event needs attention when the server-side risk engine raised any
 * flag OR its chain of custody is still open (no disposal confirmation).
 * Everything here reads through RLS-scoped views/tables — no service role.
 */

// A plain string, not a closed union: migration 022 added `missing_required:
// <item>` — a dynamically-suffixed flag (one per missing required-evidence
// item) that can never be enumerated as a fixed literal. The rendering side
// (ReviewQueuePage) already needs a startsWith() branch for it regardless, so
// a closed union here would buy no real safety, only force casts.
export type ReviewReason = string;

export interface FlaggedRecord {
  event: PickupEvent;
  /** Every reason, including 'custody_missing' when open — for badge rendering. */
  reasons: ReviewReason[];
  /** `reasons` minus 'custody_missing' — the ones a generic "Mark Reviewed" can actually resolve. */
  otherReasons: ReviewReason[];
  /** True only once a real disposal_confirmations row exists for this pickup's trip. */
  custodyConfirmed: boolean;
  /** True when a manager already acknowledged this record's non-custody reasons. */
  reviewed: boolean;
  /**
   * True when this record still needs attention: custody is open (this
   * alone is NEVER cleared by acknowledgement — only a real
   * disposal_confirmations row does), OR there are other reasons that
   * haven't been acknowledged yet. A record with reviewed=true but
   * custodyConfirmed=false still has needsAttention=true.
   */
  needsAttention: boolean;
}

const REVIEW_KEY_PREFIX = 'pickup_review:';

/**
 * List records needing review: latest revision per pickup, flagged by the risk
 * engine or missing custody-complete confirmation. Custody-complete (CP1) is
 * trip-based: a pickup event is closed only when it's grouped into a trip
 * (trip_id) AND that trip has a status='confirmed' disposal_confirmations row
 * from the RECEIVING FACILITY — a pickup with no trip yet is always open.
 * Acknowledged records are included with reviewed=true so the UI can filter
 * without losing history.
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
  const tripIds = [...new Set(rows.map((e) => e.trip_id).filter((id): id is string => id !== null))];

  const [{ data: confirmations, error: confErr }, { data: acks, error: ackErr }] =
    await Promise.all([
      tripIds.length > 0
        ? supabase.from('disposal_confirmations').select('trip_id').eq('status', 'confirmed').in('trip_id', tripIds)
        : Promise.resolve({ data: [] as { trip_id: string }[], error: null }),
      supabase
        .from('alert_acknowledgements')
        .select('alert_key')
        .in('alert_key', ids.map((id) => `${REVIEW_KEY_PREFIX}${id}`)),
    ]);
  if (confErr) throw confErr;
  if (ackErr) throw ackErr;

  const confirmedTripIds = new Set(
    ((confirmations as { trip_id: string }[]) ?? []).map((c) => c.trip_id)
  );
  const acked = new Set(
    ((acks as { alert_key: string }[]) ?? []).map((a) => a.alert_key.slice(REVIEW_KEY_PREFIX.length))
  );

  return rows
    .map((event) => {
      const otherReasons = [...event.risk_flags] as ReviewReason[];
      const custodyConfirmed = event.trip_id !== null && confirmedTripIds.has(event.trip_id);
      const reasons = custodyConfirmed ? otherReasons : [...otherReasons, 'custody_missing'];
      const reviewed = acked.has(event.id);
      // Custody is NEVER resolved by acknowledgement — only a real
      // disposal_confirmations row (custodyConfirmed) clears it. Other
      // reasons resolve via the ordinary ack mechanism, same as before.
      const needsAttention = !custodyConfirmed || (otherReasons.length > 0 && !reviewed);
      return { event, reasons, otherReasons, custodyConfirmed, reviewed, needsAttention };
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
