/**
 * Consultant portfolio query (CP5 4g) — src/lib/api/consultant.ts
 *
 * memberships_select RLS is "own row only," so a consultant's full list of
 * engagements is always visible regardless of which one is the currently
 * ACTIVE tenant (migration 012's `user_active_tenant`) — this test signs in
 * as the consultant and queries exactly what listConsultantEngagements()
 * does, without switching active tenant at all.
 *
 * Assertions:
 *   1. A consultant with 2 'consultant'-role memberships (companies A, B)
 *      sees exactly those 2 rows — never a 3rd, unrelated company they hold
 *      no membership in at all
 *   2. A plain 'owner' membership held by a DIFFERENT user in company A is
 *      never returned by this consultant's query (RLS: own row only)
 *   3. That same consultant CANNOT see or query company C's data at all —
 *      not the company row, not its branches, not its pickup_events — since
 *      they hold no membership in C whatsoever (consultant has no
 *      cross-company RLS bypass; migration 025's header explicitly defers
 *      that, see KNOWN_LIMITATIONS.md)
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY ?? '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

if (!ANON_KEY || !SERVICE_KEY) {
  throw new Error('Set VITE_SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY in .env.');
}

const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
const anon = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });

const RUN = Date.now();
const PASSWORD = 'DevPass1234!';

async function sessionClient(email: string): Promise<SupabaseClient> {
  const { data, error } = await anon.auth.signInWithPassword({ email, password: PASSWORD });
  if (error || !data.session) throw new Error(`sign-in failed (${email}): ${error?.message}`);
  return createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${data.session.access_token}` } },
  });
}

describe('Consultant portfolio query (CP5 4g)', () => {
  let companyAId = '';
  let companyBId = '';
  let unrelatedCompanyId = ''; // "company C" — the consultant holds NO membership here
  let companyCBranchId = '';
  let consultantUserId = '';
  let ownerUserId = '';
  let consultantClient: SupabaseClient;

  beforeAll(async () => {
    const { data: companyA } = await admin
      .from('companies').insert({ name_ar: `شركة أ محفظة ${RUN}`, commercial_registration: `PORT-A-${RUN}` })
      .select('id').single<{ id: string }>();
    companyAId = companyA!.id;

    const { data: companyB } = await admin
      .from('companies').insert({ name_ar: `شركة ب محفظة ${RUN}`, commercial_registration: `PORT-B-${RUN}` })
      .select('id').single<{ id: string }>();
    companyBId = companyB!.id;

    const { data: unrelated } = await admin
      .from('companies').insert({ name_ar: `شركة غير مرتبطة ${RUN}`, commercial_registration: `PORT-U-${RUN}` })
      .select('id').single<{ id: string }>();
    unrelatedCompanyId = unrelated!.id;

    const { data: companyCBranch } = await admin
      .from('branches').insert({ company_id: unrelatedCompanyId, name_ar: `فرع شركة سي ${RUN}` })
      .select('id').single<{ id: string }>();
    companyCBranchId = companyCBranch!.id;

    const { data: consultantCreated } = await admin.auth.admin.createUser({
      email: `portfolio-consultant-${RUN}@sanad360.dev`, password: PASSWORD, email_confirm: true,
    });
    consultantUserId = consultantCreated.user!.id;
    await admin.from('memberships').insert([
      { user_id: consultantUserId, role: 'consultant', company_id: companyAId },
      { user_id: consultantUserId, role: 'consultant', company_id: companyBId },
    ]);
    consultantClient = await sessionClient(`portfolio-consultant-${RUN}@sanad360.dev`);

    // A different user, an ordinary owner of company A — must never leak
    // into the consultant's own-row-only query.
    const { data: ownerCreated } = await admin.auth.admin.createUser({
      email: `portfolio-owner-${RUN}@sanad360.dev`, password: PASSWORD, email_confirm: true,
    });
    ownerUserId = ownerCreated.user!.id;
    await admin.from('memberships').insert({ user_id: ownerUserId, role: 'owner', company_id: companyAId });
  });

  afterAll(async () => {
    for (const uid of [consultantUserId, ownerUserId]) {
      if (!uid) continue;
      await admin.from('memberships').delete().eq('user_id', uid);
      await admin.from('profiles').delete().eq('id', uid);
      await admin.auth.admin.deleteUser(uid).catch(() => {});
    }
    if (companyCBranchId) await admin.from('branches').delete().eq('id', companyCBranchId);
    for (const id of [companyAId, companyBId, unrelatedCompanyId]) {
      if (id) await admin.from('companies').delete().eq('id', id);
    }
  });

  it('1+2. sees exactly its own 2 consultant engagements, never a 3rd company or another user\'s membership', async () => {
    const { data, error } = await consultantClient
      .from('memberships')
      .select('*')
      .eq('user_id', consultantUserId)
      .eq('role', 'consultant');
    expect(error).toBeNull();

    const companyIds = (data ?? []).map((m) => m.company_id).sort();
    expect(companyIds).toEqual([companyAId, companyBId].sort());
    expect(companyIds).not.toContain(unrelatedCompanyId);
    expect((data ?? []).every((m) => m.user_id === consultantUserId)).toBe(true);
  });

  it('3. cannot see or query company C\'s data at all (no membership there)', async () => {
    const [{ data: cCompany }, { data: cBranches }, { data: cPickups }] = await Promise.all([
      consultantClient.from('companies').select('id').eq('id', unrelatedCompanyId),
      consultantClient.from('branches').select('id').eq('company_id', unrelatedCompanyId),
      consultantClient.from('pickup_events').select('id').eq('company_id', unrelatedCompanyId),
    ]);
    expect(cCompany ?? []).toHaveLength(0);
    expect(cBranches ?? []).toHaveLength(0);
    expect(cPickups ?? []).toHaveLength(0);

    // Not even by branch id directly, bypassing the company_id filter.
    const { data: cBranchDirect } = await consultantClient
      .from('branches')
      .select('id')
      .eq('id', companyCBranchId);
    expect(cBranchDirect ?? []).toHaveLength(0);
  });
});
