/**
 * CP8 Slice D, gap 4 — Maya-side role boundaries into the applications
 * review queue.
 *
 * pending_applications_select_reviewer (035) is:
 *   can_review_documents() OR is_system_admin() OR is_full_admin()
 * which resolves (confirmed via pg_get_functiondef, not assumed) to
 * exactly: document_reviewer, admin, super_admin, system_admin. Every
 * existing test only ever signs in as document_reviewer (cp55-self-
 * service-onboarding.test.ts) — no test has ever confirmed the OTHER
 * allowed roles can see the queue, nor that the Maya-side roles which
 * should NOT have review access (support_agent, billing_accountant) are
 * actually excluded.
 *
 * Assertions (one pending_review application, one signed-in client per
 * role, same query every time):
 *   1. document_reviewer, system_admin, super_admin — each sees the row
 *   2. support_agent, billing_accountant, gov_viewer, consultant — each
 *      sees zero rows
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

const cleanupUserIds: string[] = [];
const cleanupCompanyIds: string[] = [];

// one_tenant (035) only exempts a fixed list of tenant-less roles —
// 'consultant' is NOT in it (a consultant is always engaged with a real
// tenant via company_id), so a NULL-tenant consultant membership would
// violate that CHECK. Give it a throwaway company_id; the queue-visibility
// assertion is unaffected either way (still no document_reviewer/admin
// role, still expected to see zero rows).
async function makeMayaUser(role: string): Promise<SupabaseClient> {
  const email = `mayaqueue-${role}-${RUN}@maya.sanad360.dev`;
  const { data: created } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  const userId = created!.user!.id;
  cleanupUserIds.push(userId);
  await admin.from('profiles').upsert({ id: userId, name_ar: role }, { onConflict: 'id' });

  let companyId: string | undefined;
  if (role === 'consultant') {
    const { data: co } = await admin.from('companies')
      .insert({ name_ar: `شركة استشاري ${RUN}`, commercial_registration: `CP8Q-CONS-${RUN}` })
      .select('id').single<{ id: string }>();
    companyId = co!.id;
    cleanupCompanyIds.push(companyId);
  }
  await admin.from('memberships').insert({ user_id: userId, role, company_id: companyId ?? null });
  return sessionClient(email);
}

describe('CP8 D gap 4: Maya-role boundaries into the applications review queue', () => {
  let applicantUserId = '';
  let applicationId = '';

  beforeAll(async () => {
    const email = `mayaqueue-applicant-${RUN}@applicant.sanad360.dev`;
    const { data: created } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
    applicantUserId = created!.user!.id;
    cleanupUserIds.push(applicantUserId);
    await admin.from('profiles').upsert({ id: applicantUserId, name_ar: 'applicant' }, { onConflict: 'id' });
    await admin.from('memberships').insert({ user_id: applicantUserId, role: 'applicant' });

    const { data: app } = await admin.from('pending_applications').insert({
      applicant_user_id: applicantUserId, tenant_type: 'company',
      name_ar: `طلب حدود الطابور ${RUN}`, commercial_registration: `CP8Q-${RUN}`,
      contact_email: email, status: 'pending_review', email_verified_at: new Date().toISOString(),
    }).select('id').single<{ id: string }>();
    applicationId = app!.id;
  });

  afterAll(async () => {
    if (applicationId) await admin.from('pending_applications').delete().eq('id', applicationId);
    for (const uid of cleanupUserIds) {
      await admin.from('memberships').delete().eq('user_id', uid);
      await admin.from('profiles').delete().eq('id', uid);
      await admin.auth.admin.deleteUser(uid).catch(() => {});
    }
    if (cleanupCompanyIds.length) await admin.from('companies').delete().in('id', cleanupCompanyIds);
  });

  it.each(['document_reviewer', 'system_admin', 'super_admin'])(
    '1. %s can see the pending_review application',
    async (role) => {
      const client = await makeMayaUser(role);
      const { data } = await client.from('pending_applications').select('id').eq('id', applicationId);
      expect(data).toHaveLength(1);
    }
  );

  it.each(['support_agent', 'billing_accountant', 'gov_viewer', 'consultant'])(
    '2. %s sees zero rows for the pending_review application',
    async (role) => {
      const client = await makeMayaUser(role);
      const { data } = await client.from('pending_applications').select('id').eq('id', applicationId);
      expect(data ?? []).toHaveLength(0);
    }
  );
});
