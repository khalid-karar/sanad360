/**
 * Maya-side role grant control (Migration 029)
 *
 * "Only super_admin may grant or modify a Maya-side role" — enforced via an
 * RLS INSERT/UPDATE policy AND an independent BEFORE trigger. Fixture users
 * (the super_admin/system_admin actors themselves, and the target user being
 * granted a role) are created via service_role — SETUP ONLY. The actual
 * assertions run as the real signed-in super_admin/system_admin, exercising
 * their own RLS-scoped session, exactly the scenario CP5 asked to be
 * DB-enforced (not just UI-enforced).
 *
 * Assertions:
 *   1. A real signed-in super_admin CAN grant a Maya-side role
 *      (support_agent) to another user
 *   2. A real signed-in system_admin attempting to grant a Maya-side role
 *      (support_agent) to ANOTHER user is REJECTED
 *   3. A real signed-in system_admin attempting to grant itself
 *      'super_admin' (self-escalation) is REJECTED
 *   4. A real signed-in system_admin attempting to UPDATE an existing
 *      Maya-side membership's role is REJECTED
 *   5. Ordinary tenant-side role grants remain untouched by this policy —
 *      an authenticated owner still cannot self-service-insert a new
 *      'owner' membership for someone else (proves the new policy is
 *      scoped exactly to Maya-side roles, not a general opening)
 *   6. The memberships_select bypass is scoped to MAYA-SIDE ROWS ONLY, never
 *      tenant data: a real signed-in company manager reading `memberships`
 *      sees ONLY their own row — not another company's, not even a fellow
 *      member of their OWN company (that's the pre-existing self-only
 *      policy, untouched) — proving the bypass this migration added grants
 *      no visibility into any tenant's membership data, from any caller.
 *   7. Per-read auditing of the SELECT bypass is architecturally impossible
 *      (Postgres has no SELECT trigger — the same limitation already
 *      established for support_agent). The honest, implemented substitute:
 *      every WRITE (grant/modification) of a Maya-side role produces
 *      exactly one audit_log row naming who granted what to whom.
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

const SEED = {
  companyId: 'a0000000-0000-0000-0000-000000000001',
  managerEmail: 'manager@sanad360.dev',
  password: 'DevPass1234!',
};

const RUN = Date.now();

async function sessionClient(email: string, password = SEED.password): Promise<SupabaseClient> {
  const { data, error } = await anon.auth.signInWithPassword({ email, password });
  if (error || !data.session) throw new Error(`sign-in failed (${email}): ${error?.message}`);
  return createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${data.session.access_token}` } },
  });
}

/** Create an auth user + a tenant-less Maya-side membership, via service_role (setup only). */
async function createMayaUser(emailPrefix: string, role: string): Promise<{ userId: string; client: SupabaseClient }> {
  const email = `${emailPrefix}-${RUN}@maya.sanad360.dev`;
  const { data: created, error } = await admin.auth.admin.createUser({
    email,
    password: SEED.password,
    email_confirm: true,
  });
  if (error || !created.user) throw new Error(`createUser failed: ${error?.message}`);
  const { error: memErr } = await admin.from('memberships').insert({ user_id: created.user.id, role });
  if (memErr) throw new Error(`membership insert failed: ${memErr.message}`);
  const client = await sessionClient(email);
  return { userId: created.user.id, client };
}

describe('Maya-side role grant control (Migration 029)', () => {
  let superAdminUserId = '';
  let superAdminClient: SupabaseClient;
  let systemAdminUserId = '';
  let systemAdminClient: SupabaseClient;
  let reviewerUserId = '';

  const targetUserIds: string[] = [];
  const grantedMembershipIds: string[] = [];

  async function createBareUser(emailPrefix: string): Promise<string> {
    const { data: created, error } = await admin.auth.admin.createUser({
      email: `${emailPrefix}-${RUN}@maya.sanad360.dev`,
      password: SEED.password,
      email_confirm: true,
    });
    if (error || !created.user) throw new Error(`createUser failed: ${error?.message}`);
    targetUserIds.push(created.user.id);
    return created.user.id;
  }

  beforeAll(async () => {
    const sa = await createMayaUser('super-admin', 'super_admin');
    superAdminUserId = sa.userId;
    superAdminClient = sa.client;

    const sys = await createMayaUser('system-admin', 'system_admin');
    systemAdminUserId = sys.userId;
    systemAdminClient = sys.client;

    reviewerUserId = await createMayaUser('doc-reviewer', 'document_reviewer').then((r) => r.userId);
  });

  afterAll(async () => {
    if (grantedMembershipIds.length) {
      await admin.from('memberships').delete().in('id', grantedMembershipIds);
    }
    for (const uid of [superAdminUserId, systemAdminUserId, reviewerUserId, ...targetUserIds]) {
      if (!uid) continue;
      await admin.from('memberships').delete().eq('user_id', uid);
      await admin.from('profiles').delete().eq('id', uid);
      await admin.auth.admin.deleteUser(uid).catch(() => {});
    }
  });

  it('1. a real signed-in super_admin CAN grant a Maya-side role to another user', async () => {
    const targetId = await createBareUser('target-granted-by-sa');
    const { data, error } = await superAdminClient
      .from('memberships')
      .insert({ user_id: targetId, role: 'support_agent' })
      .select('id, role')
      .single<{ id: string; role: string }>();

    expect(error).toBeNull();
    expect(data).not.toBeNull();
    grantedMembershipIds.push(data!.id);
    expect(data!.role).toBe('support_agent');
  });

  it('2. a real signed-in system_admin CANNOT grant a Maya-side role to another user', async () => {
    const targetId = await createBareUser('target-denied-by-sysadmin');
    const { data, error } = await systemAdminClient
      .from('memberships')
      .insert({ user_id: targetId, role: 'support_agent' })
      .select('id');

    expect(error).not.toBeNull();
    expect(data).toBeNull();

    // Confirm nothing was actually created via any other path either.
    const { data: leaked } = await admin.from('memberships').select('id').eq('user_id', targetId);
    expect(leaked ?? []).toHaveLength(0);
  });

  it("3. a system_admin attempting to grant ITSELF 'super_admin' is REJECTED (no self-escalation)", async () => {
    const { data, error } = await systemAdminClient
      .from('memberships')
      .insert({ user_id: systemAdminUserId, role: 'super_admin' })
      .select('id');

    expect(error).not.toBeNull();
    expect(data).toBeNull();

    const { data: stillSystemAdmin } = await admin
      .from('memberships')
      .select('role')
      .eq('user_id', systemAdminUserId)
      .single<{ role: string }>();
    expect(stillSystemAdmin!.role).toBe('system_admin');
  });

  it('4. a system_admin CANNOT update an existing Maya-side membership (e.g. a document_reviewer)', async () => {
    const { data: reviewerMembership } = await admin
      .from('memberships')
      .select('id')
      .eq('user_id', reviewerUserId)
      .single<{ id: string }>();

    const { data, error } = await systemAdminClient
      .from('memberships')
      .update({ role: 'support_agent' })
      .eq('id', reviewerMembership!.id)
      .select('id');

    // Either an explicit RLS error, or a silent zero-rows-affected outcome
    // (the USING clause simply doesn't match the row for this caller) — both
    // are the correct, secure result; what matters is verified below: the
    // row is provably unchanged.
    expect(error !== null || !data || data.length === 0).toBe(true);

    const { data: stillReviewer } = await admin
      .from('memberships')
      .select('role')
      .eq('id', reviewerMembership!.id)
      .single<{ role: string }>();
    expect(stillReviewer!.role).toBe('document_reviewer');
  });

  it('5. ordinary tenant-side role grants remain untouched — an authenticated manager still cannot self-service-grant "owner" to someone else', async () => {
    const managerClient = await sessionClient(SEED.managerEmail);
    const targetId = await createBareUser('target-tenant-role');

    const { data, error } = await managerClient
      .from('memberships')
      .insert({ user_id: targetId, role: 'owner', company_id: SEED.companyId })
      .select('id');

    // Unaffected by 029's new policy (role='owner' isn't Maya-side, so that
    // policy contributes nothing) — still rejected exactly as before this
    // migration, since no INSERT policy exists for tenant-side roles either.
    expect(error).not.toBeNull();
    expect(data).toBeNull();
  });

  it('6. the memberships_select bypass is scoped to Maya-side rows only — a company manager sees ONLY their own row', async () => {
    const managerClient = await sessionClient(SEED.managerEmail);

    // A second company + its own owner, unrelated to SEED.companyId.
    const { data: otherCompany } = await admin
      .from('companies')
      .insert({ name_ar: 'شركة أخرى (029)', commercial_registration: `MRC-${RUN}` })
      .select('id')
      .single<{ id: string }>();
    const otherUserId = await createBareUser('other-company-owner');
    const { data: otherMembership } = await admin
      .from('memberships')
      .insert({ user_id: otherUserId, role: 'owner', company_id: otherCompany!.id })
      .select('id')
      .single<{ id: string }>();

    // The seeded manager cannot see the other company's owner membership...
    const { data: crossTenant } = await managerClient
      .from('memberships')
      .select('id')
      .eq('id', otherMembership!.id);
    expect(crossTenant ?? []).toHaveLength(0);

    // ...and reading the whole table returns ONLY their own row (self-only
    // policy, pre-existing and untouched — no fellow-member visibility
    // either, since 029 never granted any tenant-side visibility at all).
    const { data: allVisible } = await managerClient.from('memberships').select('user_id');
    expect(allVisible).toHaveLength(1);

    await admin.from('memberships').delete().eq('id', otherMembership!.id);
    await admin.from('companies').delete().eq('id', otherCompany!.id);
  });

  it('7. every Maya-side role grant/modification writes exactly one audit_log row', async () => {
    const targetId = await createBareUser('target-for-audit');
    const { data: granted, error } = await superAdminClient
      .from('memberships')
      .insert({ user_id: targetId, role: 'billing_accountant' })
      .select('id')
      .single<{ id: string }>();
    expect(error).toBeNull();
    grantedMembershipIds.push(granted!.id);

    const { data: logs } = await admin
      .from('audit_log')
      .select('action, tenant_type, tenant_id, changes')
      .eq('entity_type', 'memberships')
      .eq('entity_id', granted!.id);

    expect(logs).toHaveLength(1);
    expect(logs![0].action).toBe('grant_maya_role');
    expect(logs![0].tenant_type).toBe('admin');
    expect(logs![0].tenant_id).toBeNull();
    expect(logs![0].changes).toMatchObject({ granted_role: 'billing_accountant', target_user_id: targetId });
  });
});
