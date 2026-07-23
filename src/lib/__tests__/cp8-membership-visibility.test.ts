/**
 * CP8 Slice D, gap 7 — revoked-membership cross-visibility.
 *
 * FINDING (documenting real current behavior, not a vulnerability — see
 * note below): memberships has exactly TWO SELECT policies (confirmed via
 * grep across every migration, not assumed):
 *   - memberships_select (001): USING (user_id = auth.uid()) — own row only
 *   - memberships_select_maya_role (029): super_admin viewing OTHER
 *     Maya-role rows only (admin/super_admin/system_admin/support_agent/
 *     billing_accountant/document_reviewer/gov_viewer)
 * Neither policy's condition depends on revoked_at at all. The practical
 * result: a company owner/manager cannot see ANY other tenant member's
 * membership row via RLS — active OR revoked. "Can other tenant members
 * still see a revoked row" (the B audit's framed question) therefore isn't
 * a distinguishing scenario: there is no cross-member visibility at ALL,
 * revoked or not. This is fail-CLOSED (under-grants, not over-grants) — not
 * a security hole to fix here. It does mean revokeMembership() (services/
 * pdf, migration 032) has no frontend caller yet (grep confirms only this
 * test file calls it) and no page currently lists a company's OTHER
 * members at all — a product-completeness gap for a future "team
 * management" UI, not something this slice's remit covers (RLS coverage,
 * not feature-building). Flagging here per the standing instruction to
 * surface real current behavior, not silently patch or invent a policy.
 *
 * Also confirms a real nuance: the own-row policy has NO revoked_at
 * condition, so a revoked user's OWN row remains directly SELECT-able by
 * that same user via raw RLS — it's fetchMyProfile()'s own application-
 * level `.is('revoked_at', null)` filter (src/lib/api/auth.ts), not RLS,
 * that turns a revoked membership into the MEMBERSHIP_REVOKED error. A
 * raw, unfiltered query still returns the row.
 *
 * Assertions:
 *   1. A user sees their own membership row while active
 *   2. After revocation, that SAME user still sees their own row via a raw
 *      RLS query (RLS doesn't gate on revoked_at — only the app-level query
 *      filter does)
 *   3. A different member of the SAME company sees zero rows for either
 *      the active or the revoked teammate's membership
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY ?? '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
if (!ANON_KEY || !SERVICE_KEY) throw new Error('Set VITE_SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY in .env.');

const admin: SupabaseClient = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
const anon: SupabaseClient = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });

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

describe('CP8 D gap 7: membership row visibility (own-row-only, revoked or not)', () => {
  let companyId = '';
  let ownerUserId = '';
  let managerUserId = '';
  let ownerMembershipId = '';
  let managerMembershipId = '';
  let ownerClient: SupabaseClient;
  let managerClient: SupabaseClient;

  beforeAll(async () => {
    const { data: company } = await admin.from('companies').insert({
      name_ar: `شركة رؤية العضوية ${RUN}`, commercial_registration: `CP8MEM-${RUN}`,
    }).select('id').single<{ id: string }>();
    companyId = company!.id;

    const ownerEmail = `mem-owner-${RUN}@sanad360.dev`;
    const { data: ownerAuth } = await admin.auth.admin.createUser({ email: ownerEmail, password: PASSWORD, email_confirm: true });
    ownerUserId = ownerAuth!.user!.id;
    await admin.from('profiles').upsert({ id: ownerUserId, name_ar: 'owner' }, { onConflict: 'id' });
    const { data: ownerMem } = await admin.from('memberships').insert({ user_id: ownerUserId, role: 'owner', company_id: companyId }).select('id').single<{ id: string }>();
    ownerMembershipId = ownerMem!.id;

    const managerEmail = `mem-manager-${RUN}@sanad360.dev`;
    const { data: managerAuth } = await admin.auth.admin.createUser({ email: managerEmail, password: PASSWORD, email_confirm: true });
    managerUserId = managerAuth!.user!.id;
    await admin.from('profiles').upsert({ id: managerUserId, name_ar: 'manager' }, { onConflict: 'id' });
    const { data: managerMem } = await admin.from('memberships').insert({ user_id: managerUserId, role: 'manager', company_id: companyId }).select('id').single<{ id: string }>();
    managerMembershipId = managerMem!.id;

    ownerClient = await sessionClient(ownerEmail);
    managerClient = await sessionClient(managerEmail);
  });

  afterAll(async () => {
    for (const uid of [ownerUserId, managerUserId]) {
      await admin.from('memberships').delete().eq('user_id', uid);
      await admin.from('profiles').delete().eq('id', uid);
      await admin.auth.admin.deleteUser(uid).catch(() => {});
    }
    if (companyId) await admin.from('companies').delete().eq('id', companyId);
  });

  it('1. the manager sees their own (active) membership row', async () => {
    const { data } = await managerClient.from('memberships').select('id').eq('id', managerMembershipId);
    expect(data).toHaveLength(1);
  });

  it('2. after revocation, the SAME user still sees their own row via raw RLS (no revoked_at gate in the policy)', async () => {
    await admin.from('memberships').update({
      revoked_at: new Date().toISOString(), revoked_by: ownerUserId, revoke_reason: 'CP8 gap 7 test',
    }).eq('id', managerMembershipId);

    const { data } = await managerClient.from('memberships').select('id, revoked_at').eq('id', managerMembershipId);
    expect(data).toHaveLength(1);
    expect(data![0].revoked_at).not.toBeNull();
  });

  it('3. a different member of the SAME company sees zero rows for the teammate\'s row, active or revoked', async () => {
    const { data: ownerViewOfManager } = await ownerClient.from('memberships').select('id').eq('id', managerMembershipId);
    expect(ownerViewOfManager ?? []).toHaveLength(0);

    const { data: managerViewOfOwner } = await managerClient.from('memberships').select('id').eq('id', ownerMembershipId);
    expect(managerViewOfOwner ?? []).toHaveLength(0);
  });
});
