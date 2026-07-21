import { supabase } from '../supabase';
import type { PickupEvent, PickupConfirmation } from '../database.types';

/**
 * Pickups at this branch currently awaiting a branch_operator's
 * confirmation. compliance_status='pending_confirmation' (migration 030) is
 * exactly this state — a pickup whose evidence_requirements demand a branch
 * confirmation, which hasn't arrived (or been rejected) yet. Once a
 * pickup_confirmations row is inserted, an AFTER INSERT trigger
 * (recompute_pickup_compliance, migration 030) recomputes this pickup out of
 * 'pending_confirmation' automatically — never client-side.
 */
export async function listPendingConfirmations(branchId: string): Promise<PickupEvent[]> {
  const { data, error } = await supabase
    .from('pickup_events')
    .select('*')
    .eq('branch_id', branchId)
    .eq('compliance_status', 'pending_confirmation')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data as PickupEvent[]) ?? [];
}

/** This branch's confirmation history (both confirmed and disputed). */
export async function listConfirmationHistory(branchId: string): Promise<PickupConfirmation[]> {
  const { data, error } = await supabase
    .from('pickup_confirmations')
    .select('*')
    .eq('branch_id', branchId)
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) throw error;
  return (data as PickupConfirmation[]) ?? [];
}

export interface ConfirmPickupInput {
  gps_lat?: number;
  gps_lng?: number;
  gps_accuracy_m?: number;
}

/**
 * Confirm a pickup in-app — the "fully sufficient" method per the seeded
 * confirmation_method_policy default (migration 026). branch_id/company_id
 * are server-forced from the referenced pickup_event (BEFORE INSERT
 * trigger) regardless of what's sent here; RLS additionally requires the
 * caller's own membership.branch_id to match.
 */
export async function confirmPickup(
  pickupEventId: string,
  input: ConfirmPickupInput = {}
): Promise<PickupConfirmation> {
  const { data, error } = await supabase
    .from('pickup_confirmations')
    .insert({
      pickup_event_id: pickupEventId,
      method: 'in_app_confirm',
      status: 'confirmed',
      gps_lat: input.gps_lat,
      gps_lng: input.gps_lng,
      gps_accuracy_m: input.gps_accuracy_m,
    })
    .select('*')
    .single<PickupConfirmation>();
  if (error) throw error;
  return data;
}

/**
 * Dispute a pickup — the branch operator asserts the pickup as recorded
 * doesn't match what happened at the waste point. dispute_reason is
 * mandatory (CHECK constraint, migration 026). method stays 'in_app_confirm'
 * — the operator IS actively disputing from the app; 'unavailable' is a
 * separate method meaning "no branch confirmation was possible at all,"
 * which is a different scenario from an active dispute.
 */
export async function disputePickup(
  pickupEventId: string,
  disputeReason: string
): Promise<PickupConfirmation> {
  const { data, error } = await supabase
    .from('pickup_confirmations')
    .insert({
      pickup_event_id: pickupEventId,
      method: 'in_app_confirm',
      status: 'disputed',
      dispute_reason: disputeReason,
    })
    .select('*')
    .single<PickupConfirmation>();
  if (error) throw error;
  return data;
}
