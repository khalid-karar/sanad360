import { supabase } from '../supabase';
import { PDF_SERVICE_URL } from '../pdfServiceUrl';
import type { Facility, FacilityTransporter, Trip } from '../database.types';

/** Facilities visible to the caller (own facility, or actively-linked for transporters). */
export async function listVisibleFacilities(): Promise<Facility[]> {
  const { data, error } = await supabase.from('facilities').select('*').order('name_ar');
  if (error) throw error;
  return (data as Facility[]) ?? [];
}

export async function listFacilityTransporterLinks(): Promise<FacilityTransporter[]> {
  const { data, error } = await supabase.from('facility_transporters').select('*');
  if (error) throw error;
  return (data as FacilityTransporter[]) ?? [];
}

/**
 * Facilities a transport company may plan a trip into: resolved through its
 * ACTIVE facility_transporters links (mirrors
 * companyTransporters.listTransportersForCompany). trips_before_insert
 * re-validates this server-side regardless.
 */
export async function listActiveFacilitiesForTransport(
  transportCompanyId: string
): Promise<Facility[]> {
  const { data, error } = await supabase
    .from('facility_transporters')
    .select('facility:facilities(*)')
    .eq('transport_company_id', transportCompanyId)
    .eq('status', 'active');
  if (error) throw error;

  const rows = (data as unknown as { facility: Facility | null }[]) ?? [];
  return rows.map((r) => r.facility).filter((f): f is Facility => f !== null);
}

async function authHeader(): Promise<Record<string, string>> {
  const { data: { session }, error } = await supabase.auth.getSession();
  if (error || !session) throw new Error('Not authenticated');
  return { Authorization: `Bearer ${session.access_token}` };
}

export interface ValidateTripQrResult {
  trip: Trip;
  facility: { id: string; name_ar: string; name_en: string | null; license_number: string | null; city: string | null } | null;
  driver: { id: string; name_ar: string; license_number: string; license_expiry: string } | null;
  vehicle: { id: string; plate_number: string; type: string; ncwm_license_number: string | null; ncwm_license_expiry: string } | null;
}

/** Scale operator scans/enters a driver's trip QR token; server validates + returns the trip. */
export async function validateTripQrToken(token: string): Promise<ValidateTripQrResult> {
  const headers = await authHeader();
  const res = await fetch(`${PDF_SERVICE_URL}/recycler/validate-trip-qr`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  });
  if (!res.ok) {
    const json = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(json.error ?? `QR validation failed (${res.status})`);
  }
  return res.json() as Promise<ValidateTripQrResult>;
}
