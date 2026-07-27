import { supabase } from '../supabase';
import type { Membership } from '../database.types';

export interface ConsultantEngagement {
  membership: Membership;
  companyName: string | null;
}

/**
 * This consultant's engaged companies (migration 024: consultant holds one
 * `memberships` row per engaged company, same tenant shape as owner/manager
 * — NOT a single cross-company membership). memberships_select RLS is
 * "own row only" (user_id = auth.uid()), so this always returns every
 * engagement regardless of which one is currently the ACTIVE tenant.
 *
 * Per-company KPIs are deliberately NOT fetched here: pickup_events/companies
 * RLS scopes to the caller's ACTIVE membership only (my_membership()) —
 * consultant has no cross-company RLS bypass, an explicitly deferred
 * decision (migration 025's header: "consultant's engagement-scope
 * restrictions in RLS — no policy surface to write yet"). Viewing a given
 * company's real numbers means switching into it first (switchTenant,
 * migration 012's existing mechanism) — this page is a launchpad into that
 * switch, not a simultaneous multi-tenant dashboard.
 */
export async function listConsultantEngagements(userId: string): Promise<ConsultantEngagement[]> {
  const { data: memberships, error } = await supabase
    .from('memberships')
    .select('*')
    .eq('user_id', userId)
    .eq('role', 'consultant')
    .order('created_at', { ascending: true });
  if (error) throw error;

  const rows = (memberships as Membership[]) ?? [];
  if (rows.length === 0) return [];

  const companyIds = rows.map((m) => m.company_id).filter(Boolean) as string[];
  const transportIds = rows.map((m) => m.transport_company_id).filter(Boolean) as string[];

  const [companiesRes, transportRes] = await Promise.all([
    companyIds.length
      ? supabase.from('companies').select('id, name_ar').in('id', companyIds)
      : Promise.resolve({ data: [] as { id: string; name_ar: string }[] }),
    transportIds.length
      ? supabase.from('transport_companies').select('id, name_ar').in('id', transportIds)
      : Promise.resolve({ data: [] as { id: string; name_ar: string }[] }),
  ]);

  const names = new Map<string, string>();
  for (const c of companiesRes.data ?? []) names.set(c.id, c.name_ar);
  for (const t of transportRes.data ?? []) names.set(t.id, t.name_ar);

  return rows.map((membership) => ({
    membership,
    companyName: names.get(membership.company_id ?? membership.transport_company_id ?? '') ?? null,
  }));
}
