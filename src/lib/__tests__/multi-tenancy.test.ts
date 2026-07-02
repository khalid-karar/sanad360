/**
 * Consultant Multi-Tenancy (Migration 012)
 *
 * memberships always allowed one user in many tenants, but my_membership()
 * used LIMIT 1 with no ORDER BY — the effective tenant was nondeterministic.
 * 012 makes it deterministic (oldest membership) and user-selectable via
 * user_active_tenant, without touching any policy.
 *
 * Assertions (as a real signed-in consultant with two company memberships):
 *   1. Default = OLDEST membership: sees company A branches, zero of B's
 *   2. Selecting the B membership flips visibility: sees B, zero of A's
 *   3. Cannot select ANOTHER USER's membership (WITH CHECK)
 *   4. Can read the names of ALL owned-membership tenants (switcher labels)
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? 'http://localhost:54321';
const ANON_KEY     = process.env.VITE_SUPABASE_ANON_KEY ?? '';
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

if (!ANON_KEY || !SERVICE_KEY) {
  throw new Error(
    'Set VITE_SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY in .env before running tests.'
  );
}

const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
const anon  = createClient(SUPABASE_URL, ANON_KEY,    { auth: { persistSession: false } });

const SEED = {
  companyId: 'a0000000-0000-0000-0000-000000000001', // company A (seeded)
  managerMembershipId: '10000000-0000-0000-0000-000000000001',
};

const RUN = Date.now();
const CONSULTANT_EMAIL = `consultant-${RUN}@sanad360.dev`;
const PASSWORD = 'DevPass1234!';

async function sessionClient(email: string, password = PASSWORD): Promise<SupabaseClient> {
  const { data, error } = await anon.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${data.session!.access_token}` } },
  });
}

describe('Consultant multi-tenancy (Migration 012)', () => {
  let consultant: SupabaseClient;
  let consultantId = '';
  let companyBId = '';
  let branchAId = '';
  let branchBId = '';
  let membershipBId = '';

  beforeAll(async () => {
    // Company B with one branch (company A + its branch come from the seed;
    // we add a dedicated branch to A for an unambiguous visibility check).
    const { data: cb } = await admin
      .from('companies')
      .insert({ name_ar: `شركة الاستشاري ب ${RUN}`, commercial_registration: `CR-MT-${RUN}` })
      .select('id')
      .single<{ id: string }>();
    companyBId = cb!.id;

    const { data: ba } = await admin
      .from('branches')
      .insert({ company_id: SEED.companyId, name_ar: `فرع أ للاستشاري ${RUN}` })
      .select('id')
      .single<{ id: string }>();
    branchAId = ba!.id;

    const { data: bb } = await admin
      .from('branches')
      .insert({ company_id: companyBId, name_ar: `فرع ب للاستشاري ${RUN}` })
      .select('id')
      .single<{ id: string }>();
    branchBId = bb!.id;

    // Consultant with TWO memberships; created_at set explicitly so the
    // "oldest wins" fallback is unambiguous (A older than B).
    const { data: created } = await admin.auth.admin.createUser({
      email: CONSULTANT_EMAIL,
      password: PASSWORD,
      email_confirm: true,
      user_metadata: { name_ar: 'استشاري امتثال' },
    });
    consultantId = created.user!.id;

    await admin
      .from('memberships')
      .insert({
        user_id: consultantId,
        role: 'manager',
        company_id: SEED.companyId,
        created_at: new Date(RUN - 60_000).toISOString(),
      });

    const { data: mB } = await admin
      .from('memberships')
      .insert({
        user_id: consultantId,
        role: 'manager',
        company_id: companyBId,
        created_at: new Date(RUN).toISOString(),
      })
      .select('id')
      .single<{ id: string }>();
    membershipBId = mB!.id;

    consultant = await sessionClient(CONSULTANT_EMAIL);
  });

  afterAll(async () => {
    if (consultantId) {
      await admin.from('user_active_tenant').delete().eq('user_id', consultantId);
      await admin.from('memberships').delete().eq('user_id', consultantId);
      await admin.from('profiles').delete().eq('id', consultantId);
      await admin.auth.admin.deleteUser(consultantId);
    }
    if (branchAId) await admin.from('branches').delete().eq('id', branchAId);
    if (branchBId) await admin.from('branches').delete().eq('id', branchBId);
    if (companyBId) await admin.from('companies').delete().eq('id', companyBId);
  });

  it('1. default tenant is the OLDEST membership (deterministic)', async () => {
    const { data: aBranches } = await consultant
      .from('branches')
      .select('id')
      .eq('id', branchAId);
    expect(aBranches).toHaveLength(1);

    const { data: bBranches } = await consultant
      .from('branches')
      .select('id')
      .eq('id', branchBId);
    expect(bBranches ?? []).toHaveLength(0);
  });

  it('2. selecting the B membership flips RLS visibility', async () => {
    const { error } = await consultant
      .from('user_active_tenant')
      .upsert({ user_id: consultantId, membership_id: membershipBId }, { onConflict: 'user_id' });
    expect(error).toBeNull();

    const { data: bBranches } = await consultant
      .from('branches')
      .select('id')
      .eq('id', branchBId);
    expect(bBranches).toHaveLength(1);

    const { data: aBranches } = await consultant
      .from('branches')
      .select('id')
      .eq('id', branchAId);
    expect(aBranches ?? []).toHaveLength(0);
  });

  it("3. cannot select another user's membership", async () => {
    const { error } = await consultant
      .from('user_active_tenant')
      .upsert(
        { user_id: consultantId, membership_id: SEED.managerMembershipId },
        { onConflict: 'user_id' }
      );
    expect(error).not.toBeNull();
  });

  it('4. can read the names of all owned-membership tenants (switcher labels)', async () => {
    // Active tenant is currently B (test 2), yet company A's name must still
    // be readable via companies_select_for_own_memberships.
    const { data: companies, error } = await consultant
      .from('companies')
      .select('id, name_ar')
      .in('id', [SEED.companyId, companyBId]);
    expect(error).toBeNull();
    expect((companies ?? []).map((c) => c.id).sort()).toEqual(
      [SEED.companyId, companyBId].sort()
    );
  });
});
