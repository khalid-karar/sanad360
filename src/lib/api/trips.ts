import { supabase } from '../supabase';
import { PDF_SERVICE_URL } from '../pdfServiceUrl';
import type { CreateTripInput, Trip } from '../database.types';

/** Transport dispatcher's own trips (RLS: whole fleet for owner/manager/dispatcher). */
export async function listTransportTrips(): Promise<Trip[]> {
  const { data, error } = await supabase
    .from('trips')
    .select('*')
    .order('trip_date', { ascending: false })
    .limit(100);
  if (error) throw error;
  return (data as Trip[]) ?? [];
}

/** The signed-in driver's own trips (RLS scopes this to their driver record). */
export async function listDriverTrips(): Promise<Trip[]> {
  const { data, error } = await supabase
    .from('trips')
    .select('*')
    .neq('status', 'cancelled')
    .order('trip_date', { ascending: false })
    .limit(50);
  if (error) throw error;
  return (data as Trip[]) ?? [];
}

/**
 * Plan a new trip. planned_facility_id must be a facility actively linked to
 * the caller's transport company (facility_transporters) — enforced by the
 * trips_before_insert trigger, not just this client call.
 */
export async function createTrip(input: CreateTripInput): Promise<Trip> {
  const { data, error } = await supabase
    .from('trips')
    .insert(input)
    .select()
    .single<Trip>();
  if (error) throw error;
  return data;
}

/** Move a trip through its planning states (planned -> in_progress -> dropped_off, or cancelled). */
export async function updateTripStatus(
  tripId: string,
  status: 'in_progress' | 'dropped_off' | 'cancelled'
): Promise<void> {
  const { error } = await supabase.from('trips').update({ status }).eq('id', tripId);
  if (error) throw error;
}

async function authHeader(): Promise<Record<string, string>> {
  const { data: { session }, error } = await supabase.auth.getSession();
  if (error || !session) throw new Error('Not authenticated');
  return { Authorization: `Bearer ${session.access_token}` };
}

export interface IssuedTripQr {
  token: string;
  expires_at: string;
}

/** Ask the PDF/backend service for a short-TTL, HMAC-signed QR token for this trip. */
export async function issueTripQrToken(tripId: string): Promise<IssuedTripQr> {
  const headers = await authHeader();
  const res = await fetch(`${PDF_SERVICE_URL}/trips/${tripId}/qr`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
  });
  if (!res.ok) {
    const json = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(json.error ?? `Failed to issue trip QR (${res.status})`);
  }
  return res.json() as Promise<IssuedTripQr>;
}
