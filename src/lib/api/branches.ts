import { supabase } from '../supabase';
import { PDF_SERVICE_URL } from '../pdfServiceUrl';
import type { Branch } from '../database.types';

// Explicit column list — matches the column-level GRANTs in migration 023.
// qr_token is a server-only HMAC secret and was never re-added here; a bare
// select('*') would now 42501 the moment the SELECT privilege check runs.
// Exported so every other module querying `branches` (companies.ts) uses the
// same list rather than drifting.
export const BRANCH_COLUMNS =
  'id, company_id, name_ar, name_en, address_ar, city, geofence_lat, geofence_lng, geofence_radius_m, status, created_at';

export interface CreateBranchInput {
  company_id: string;
  name_ar: string;
  name_en?: string;
  address_ar?: string;
  city?: string;
  geofence_lat?: number;
  geofence_lng?: number;
  geofence_radius_m?: number;
}

export type UpdateBranchInput = Partial<
  Omit<Branch, 'id' | 'company_id' | 'created_at'>
>;

/** List branches for a company (active + inactive). RLS still scopes to tenant. */
export async function listBranches(companyId?: string): Promise<Branch[]> {
  let query = supabase.from('branches').select(BRANCH_COLUMNS).order('name_ar');
  if (companyId) query = query.eq('company_id', companyId);

  const { data, error } = await query;
  if (error) throw error;
  return (data as Branch[]) ?? [];
}

export async function createBranch(input: CreateBranchInput): Promise<Branch> {
  const { data, error } = await supabase
    .from('branches')
    .insert({
      geofence_radius_m: 150,
      ...input,
    })
    .select(BRANCH_COLUMNS)
    .single<Branch>();

  if (error) throw error;
  return data;
}

export async function updateBranch(
  id: string,
  fields: UpdateBranchInput
): Promise<Branch> {
  const { data, error } = await supabase
    .from('branches')
    .update(fields)
    .eq('id', id)
    .select(BRANCH_COLUMNS)
    .single<Branch>();

  if (error) throw error;
  return data;
}

export interface IssuedBranchQr {
  token: string;
  expires_at: string; // ISO
}

async function authHeader(): Promise<Record<string, string>> {
  const { data: { session }, error } = await supabase.auth.getSession();
  if (error || !session) throw new Error('Not authenticated');
  return { Authorization: `Bearer ${session.access_token}` };
}

/**
 * Ask services/pdf for a short-TTL (90s), HMAC-signed QR token for this
 * branch's own display device to render (migration 022/Part B — the branch's
 * qr_token secret itself never reaches the client; only this signed
 * derivative does, and it must be re-requested before it expires).
 */
export async function requestBranchQrToken(branchId: string): Promise<IssuedBranchQr> {
  const headers = await authHeader();
  const res = await fetch(`${PDF_SERVICE_URL}/branches/${branchId}/qr`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
  });
  if (!res.ok) {
    const json = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(json.error ?? `Failed to issue branch QR (${res.status})`);
  }
  return res.json() as Promise<IssuedBranchQr>;
}

/** Soft delete — sets status='inactive' so historical pickup_events stay intact. */
export async function deleteBranch(id: string): Promise<Branch> {
  return updateBranch(id, { status: 'inactive' });
}
