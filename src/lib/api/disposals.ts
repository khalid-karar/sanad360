import { supabase } from '../supabase';
import { uploadEvidenceFile } from './storage';
import type { DisposalConfirmation, CreateDisposalConfirmationInput, Trip } from '../database.types';

const WEIGHBRIDGE_BUCKET = 'weighbridge-photos';

/** A trip planned into this facility with no disposal_confirmations row yet. */
export interface InboundTrip {
  trip: Trip;
}

/**
 * List this facility's inbound trips still awaiting confirmation. RLS scopes
 * `trips` to the caller's own facility (planned_facility_id) and
 * `disposal_confirmations` the same way, so both queries are already
 * tenant-isolated — we just diff them client-side.
 */
export async function listInboundTrips(): Promise<InboundTrip[]> {
  const { data: trips, error } = await supabase
    .from('trips')
    .select('*')
    .not('status', 'in', '("cancelled","reconciled")')
    .order('trip_date', { ascending: false })
    .limit(100);
  if (error) throw error;

  const rows = (trips as Trip[]) ?? [];
  if (rows.length === 0) return [];

  const { data: confirmations, error: confErr } = await supabase
    .from('disposal_confirmations')
    .select('trip_id')
    .in('trip_id', rows.map((t) => t.id));
  if (confErr) throw confErr;

  const confirmed = new Set(((confirmations as { trip_id: string }[]) ?? []).map((c) => c.trip_id));
  return rows.filter((t) => !confirmed.has(t.id)).map((trip) => ({ trip }));
}

/** History of confirmations at this facility (recycler_manager view). */
export async function listFacilityConfirmations(): Promise<DisposalConfirmation[]> {
  const { data, error } = await supabase
    .from('disposal_confirmations')
    .select('*')
    .order('confirmed_at', { ascending: false })
    .limit(100);
  if (error) throw error;
  return (data as DisposalConfirmation[]) ?? [];
}

/** Fetch the confirmation for one trip (null when not yet confirmed/rejected). */
export async function getDisposalConfirmation(tripId: string): Promise<DisposalConfirmation | null> {
  const { data, error } = await supabase
    .from('disposal_confirmations')
    .select('*')
    .eq('trip_id', tripId)
    .maybeSingle<DisposalConfirmation>();
  if (error) throw error;
  return data;
}

/**
 * Record the recycler's own confirmation (or rejection) of a trip's
 * drop-off. Only a scale_operator of the RECEIVING facility may call this —
 * enforced server-side (RLS + BEFORE INSERT trigger), not just here. On
 * confirmation, the DB automatically reconciles Σ(pickup weights) against
 * net_weight_kg (migration 018); no client action needed for that.
 */
export async function createDisposalConfirmation(
  trip: Pick<Trip, 'id' | 'planned_facility_id'>,
  input: Omit<CreateDisposalConfirmationInput, 'trip_id' | 'weighbridge_photo_path' | 'weighbridge_photo_sha256'>,
  weighbridgePhoto?: File
): Promise<DisposalConfirmation> {
  let weighbridge_photo_path: string | undefined;
  let weighbridge_photo_sha256: string | undefined;

  if (weighbridgePhoto) {
    const ext = weighbridgePhoto.name.split('.').pop() ?? 'jpg';
    const path = `${trip.planned_facility_id}/${trip.id}/weighbridge.${ext}`;
    const uploaded = await uploadEvidenceFile(
      WEIGHBRIDGE_BUCKET,
      path,
      weighbridgePhoto,
      weighbridgePhoto.type || 'image/jpeg'
    );
    weighbridge_photo_path = uploaded.path;
    weighbridge_photo_sha256 = uploaded.sha256;
  }

  const { data, error } = await supabase
    .from('disposal_confirmations')
    .insert({
      trip_id: trip.id,
      ...input,
      weighbridge_photo_path,
      weighbridge_photo_sha256,
      // facility_id / transport_company_id / confirmed_by / confirmed_at are
      // server-set by the BEFORE INSERT trigger from the trip — we never send them.
    })
    .select()
    .single<DisposalConfirmation>();

  if (error) throw error;
  return data;
}
