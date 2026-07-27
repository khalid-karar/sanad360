import { supabase } from '../supabase';
import { PDF_SERVICE_URL } from '../pdfServiceUrl';

async function authHeader(): Promise<Record<string, string>> {
  const { data: { session }, error } = await supabase.auth.getSession();
  if (error || !session) throw new Error('Not authenticated');
  return { Authorization: `Bearer ${session.access_token}` };
}

/**
 * Soft-revokes a company-side membership (migration 032). memberships is
 * SELECT-only for authenticated (RLS), so this goes through the service-role
 * backend endpoint — same shape as trips.ts's issueTripQrToken() and
 * branches.ts's requestBranchQrToken().
 */
export async function revokeMembership(membershipId: string, reason: string): Promise<void> {
  const headers = await authHeader();
  const res = await fetch(`${PDF_SERVICE_URL}/company/revoke-membership`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ membership_id: membershipId, reason }),
  });
  if (!res.ok) {
    const json = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(json.error ?? `Failed to revoke membership (${res.status})`);
  }
}
