/**
 * CP8 Slice D, gap 2 — documents RLS for TENANT owner_types (company/
 * branch/transport_company), not driver/vehicle/pending_application.
 *
 * Found via the B audit: cp2-document-gating.test.ts only ever exercises
 * owner_type 'driver'/'vehicle'; cp55-self-service-onboarding.test.ts only
 * 'pending_application'. The actual tenant-onboarding upload path
 * (OnboardingPage.tsx, used by every real owner/manager account uploading
 * their company's/transport company's own required docs) had zero test
 * coverage at the RLS layer.
 *
 * owns_document_target (021) restricts WRITE to owner/manager only for
 * company/branch/transport_company (not dispatcher, not any tenant member)
 * — but can_view_document_target restricts READ only by tenant match, no
 * role restriction (any member of the tenant can view). This suite proves
 * both halves of that asymmetry, plus cross-tenant isolation for each.
 *
 * Assertions:
 *   1. company: owner/manager can upload; dispatcher (same company) cannot;
 *      a different company's owner cannot (cross-tenant)
 *   2. company: any member (including dispatcher) CAN view the doc; a
 *      different company's owner cannot (cross-tenant read isolation)
 *   3. branch: the owning company's manager can upload for their own
 *      branch; a different company's owner cannot
 *   4. transport_company: owner can upload; dispatcher (same transport
 *      company) cannot upload but CAN view
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

async function createMember(
  emailPrefix: string,
  role: string,
  tenant: { company_id?: string; transport_company_id?: string }
): Promise<{ userId: string; client: SupabaseClient }> {
  const email = `${emailPrefix}-${RUN}@sanad360.dev`;
  const { data: created, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (error || !created.user) throw new Error(`createUser failed: ${error?.message}`);
  const userId = created.user.id;
  await admin.from('profiles').upsert({ id: userId, name_ar: emailPrefix }, { onConflict: 'id' });
  await admin.from('memberships').insert({ user_id: userId, role, ...tenant });
  const client = await sessionClient(email);
  return { userId, client };
}

describe('CP8 D gap 2: documents RLS for company/branch/transport_company', () => {
  let companyAId = '';
  let companyBId = '';
  let branchA1Id = '';
  let tcAId = '';
  const cleanupUserIds: string[] = [];
  const cleanupDocIds: string[] = [];
  const cleanupCompanyIds: string[] = [];
  const cleanupBranchIds: string[] = [];
  const cleanupTcIds: string[] = [];

  let compAOwner: { userId: string; client: SupabaseClient };
  let compAManager: { userId: string; client: SupabaseClient };
  let compADispatcher: { userId: string; client: SupabaseClient };
  let compBOwner: { userId: string; client: SupabaseClient };
  let tcAOwner: { userId: string; client: SupabaseClient };
  let tcADispatcher: { userId: string; client: SupabaseClient };

  beforeAll(async () => {
    const { data: ca } = await admin.from('companies').insert({ name_ar: `شركة أ ${RUN}`, commercial_registration: `CP8DOC-A-${RUN}` }).select('id').single<{ id: string }>();
    companyAId = ca!.id; cleanupCompanyIds.push(companyAId);
    const { data: cb } = await admin.from('companies').insert({ name_ar: `شركة ب ${RUN}`, commercial_registration: `CP8DOC-B-${RUN}` }).select('id').single<{ id: string }>();
    companyBId = cb!.id; cleanupCompanyIds.push(companyBId);
    const { data: b1 } = await admin.from('branches').insert({ company_id: companyAId, name_ar: `فرع أ1 ${RUN}` }).select('id').single<{ id: string }>();
    branchA1Id = b1!.id; cleanupBranchIds.push(branchA1Id);
    const { data: tc } = await admin.from('transport_companies').insert({ name_ar: `ناقل أ ${RUN}`, commercial_registration: `CP8DOC-TC-${RUN}` }).select('id').single<{ id: string }>();
    tcAId = tc!.id; cleanupTcIds.push(tcAId);

    compAOwner = await createMember('docs-compA-owner', 'owner', { company_id: companyAId });
    compAManager = await createMember('docs-compA-manager', 'manager', { company_id: companyAId });
    compADispatcher = await createMember('docs-compA-dispatcher', 'dispatcher', { company_id: companyAId });
    compBOwner = await createMember('docs-compB-owner', 'owner', { company_id: companyBId });
    tcAOwner = await createMember('docs-tcA-owner', 'owner', { transport_company_id: tcAId });
    tcADispatcher = await createMember('docs-tcA-dispatcher', 'dispatcher', { transport_company_id: tcAId });
    for (const u of [compAOwner, compAManager, compADispatcher, compBOwner, tcAOwner, tcADispatcher]) {
      cleanupUserIds.push(u.userId);
    }
  });

  afterAll(async () => {
    if (cleanupDocIds.length) await admin.from('documents').delete().in('id', cleanupDocIds);
    if (cleanupBranchIds.length) await admin.from('branches').delete().in('id', cleanupBranchIds);
    if (cleanupTcIds.length) await admin.from('transport_companies').delete().in('id', cleanupTcIds);
    if (cleanupCompanyIds.length) await admin.from('companies').delete().in('id', cleanupCompanyIds);
    for (const uid of cleanupUserIds) {
      await admin.from('memberships').delete().eq('user_id', uid);
      await admin.from('profiles').delete().eq('id', uid);
      await admin.auth.admin.deleteUser(uid).catch(() => {});
    }
  });

  it('1. company doc write: owner/manager can, dispatcher cannot, a different company cannot', async () => {
    const { data: doc, error: ownerErr } = await compAOwner.client.from('documents').insert({
      owner_type: 'company', owner_id: companyAId, doc_type: 'commercial_registration',
      file_path: `company/${companyAId}/cr.pdf`, file_sha256: 'a'.repeat(64), uploaded_by: compAOwner.userId,
    }).select('id').single<{ id: string }>();
    expect(ownerErr).toBeNull();
    cleanupDocIds.push(doc!.id);

    const { data: doc2, error: managerErr } = await compAManager.client.from('documents').insert({
      owner_type: 'company', owner_id: companyAId, doc_type: 'vat_certificate',
      file_path: `company/${companyAId}/vat.pdf`, file_sha256: 'b'.repeat(64), uploaded_by: compAManager.userId,
    }).select('id').single<{ id: string }>();
    expect(managerErr).toBeNull();
    cleanupDocIds.push(doc2!.id);

    const { error: dispatcherErr } = await compADispatcher.client.from('documents').insert({
      owner_type: 'company', owner_id: companyAId, doc_type: 'vat_certificate',
      file_path: `company/${companyAId}/vat2.pdf`, file_sha256: 'c'.repeat(64), uploaded_by: compADispatcher.userId,
    });
    expect(dispatcherErr).not.toBeNull();
    expect(dispatcherErr!.code).toBe('42501');

    const { error: crossTenantErr } = await compBOwner.client.from('documents').insert({
      owner_type: 'company', owner_id: companyAId, doc_type: 'vat_certificate',
      file_path: `company/${companyAId}/vat3.pdf`, file_sha256: 'd'.repeat(64), uploaded_by: compBOwner.userId,
    });
    expect(crossTenantErr).not.toBeNull();
    expect(crossTenantErr!.code).toBe('42501');
  });

  it('2. company doc read: any tenant member (including dispatcher) can view; a different company cannot', async () => {
    const { data: doc } = await admin.from('documents').insert({
      owner_type: 'company', owner_id: companyAId, doc_type: 'commercial_registration',
      file_path: `company/${companyAId}/view-test.pdf`, file_sha256: 'e'.repeat(64), uploaded_by: compAOwner.userId,
    }).select('id').single<{ id: string }>();
    cleanupDocIds.push(doc!.id);

    const { data: dispatcherView } = await compADispatcher.client.from('documents').select('id').eq('id', doc!.id);
    expect(dispatcherView).toHaveLength(1);

    const { data: crossTenantView } = await compBOwner.client.from('documents').select('id').eq('id', doc!.id);
    expect(crossTenantView ?? []).toHaveLength(0);
  });

  it('3. branch doc write: owning company manager can, a different company cannot', async () => {
    const { data: doc, error: managerErr } = await compAManager.client.from('documents').insert({
      owner_type: 'branch', owner_id: branchA1Id, doc_type: 'municipal_license',
      file_path: `branch/${branchA1Id}/lic.pdf`, file_sha256: 'f'.repeat(64), uploaded_by: compAManager.userId,
    }).select('id').single<{ id: string }>();
    expect(managerErr).toBeNull();
    cleanupDocIds.push(doc!.id);

    const { error: crossTenantErr } = await compBOwner.client.from('documents').insert({
      owner_type: 'branch', owner_id: branchA1Id, doc_type: 'municipal_license',
      file_path: `branch/${branchA1Id}/lic2.pdf`, file_sha256: 'g'.repeat(64), uploaded_by: compBOwner.userId,
    });
    expect(crossTenantErr).not.toBeNull();
    expect(crossTenantErr!.code).toBe('42501');
  });

  it('4. transport_company doc write: owner can, dispatcher cannot upload but CAN view', async () => {
    const { data: doc, error: ownerErr } = await tcAOwner.client.from('documents').insert({
      owner_type: 'transport_company', owner_id: tcAId, doc_type: 'commercial_registration',
      file_path: `transport_company/${tcAId}/cr.pdf`, file_sha256: 'h'.repeat(64), uploaded_by: tcAOwner.userId,
    }).select('id').single<{ id: string }>();
    expect(ownerErr).toBeNull();
    cleanupDocIds.push(doc!.id);

    const { error: dispatcherWriteErr } = await tcADispatcher.client.from('documents').insert({
      owner_type: 'transport_company', owner_id: tcAId, doc_type: 'ncwm_license',
      file_path: `transport_company/${tcAId}/ncwm.pdf`, file_sha256: 'i'.repeat(64), uploaded_by: tcADispatcher.userId,
    });
    expect(dispatcherWriteErr).not.toBeNull();
    expect(dispatcherWriteErr!.code).toBe('42501');

    const { data: dispatcherView } = await tcADispatcher.client.from('documents').select('id').eq('id', doc!.id);
    expect(dispatcherView).toHaveLength(1);
  });
});
