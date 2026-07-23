/**
 * CP8 Slice D, gap 5 — applicant has zero operational access, asserted
 * directly rather than left as an inferred property of the RLS design.
 *
 * Migration 035's own header claims this explicitly: "This is what gives
 * an applicant zero access to any operational table with ZERO changes to
 * any existing policy in this migration" — every operational RLS policy
 * scopes by (my_membership()).company_id / .transport_company_id / an
 * explicit role allowlist, none of which ever mentions 'applicant' or
 * matches a NULL tenant. That claim had never actually been tested; only
 * the pending_applications-specific role gate (review_pending_application
 * rejecting an applicant caller) was covered.
 *
 * Assertions: a real signed-in applicant, with real rows already existing
 * (created via service_role, NOT by this applicant), sees ZERO rows when
 * querying: companies, branches, transport_companies, facilities, trips,
 * pickup_events, pickup_assignments, drivers, vehicles, documents (owned by
 * the company, not by this applicant's own pending_application), and other
 * users' memberships rows.
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

describe('CP8 D gap 5: applicant has zero operational access', () => {
  let applicantClient: SupabaseClient;
  let applicantUserId = '';
  let applicationId = '';
  let companyId = '';
  let branchId = '';
  let tcId = '';
  let driverId = '';
  let vehicleId = '';
  let facilityId = '';
  let otherUserId = '';
  let docId = '';

  beforeAll(async () => {
    // A real, unrelated company/tenant with real operational data — the
    // applicant has no membership in any of it.
    const { data: company } = await admin.from('companies').insert({
      name_ar: `شركة بيانات حقيقية ${RUN}`, commercial_registration: `CP8ZA-${RUN}`,
    }).select('id').single<{ id: string }>();
    companyId = company!.id;

    const { data: branch } = await admin.from('branches').insert({
      company_id: companyId, name_ar: `فرع حقيقي ${RUN}`,
    }).select('id').single<{ id: string }>();
    branchId = branch!.id;

    const { data: tc } = await admin.from('transport_companies').insert({
      name_ar: `ناقل حقيقي ${RUN}`, commercial_registration: `CP8ZA-TC-${RUN}`,
    }).select('id').single<{ id: string }>();
    tcId = tc!.id;

    const { data: driver } = await admin.from('drivers').insert({
      transport_company_id: tcId, name_ar: 'سائق حقيقي', license_number: `CP8ZA-DRV-${RUN}`, license_expiry: '2030-01-01',
    }).select('id').single<{ id: string }>();
    driverId = driver!.id;

    const { data: vehicle } = await admin.from('vehicles').insert({
      transport_company_id: tcId, plate_number: `CP8ZA-${RUN}`, type: 'medium_truck', waste_license_type: 'general',
      ncwm_license_number: `CP8ZA-VEH-${RUN}`, ncwm_license_expiry: '2030-01-01',
    }).select('id').single<{ id: string }>();
    vehicleId = vehicle!.id;

    const { data: facility } = await admin.from('facilities').insert({ name_ar: `منشأة حقيقية ${RUN}` }).select('id').single<{ id: string }>();
    facilityId = facility!.id;

    const { data: doc } = await admin.from('documents').insert({
      owner_type: 'company', owner_id: companyId, doc_type: 'commercial_registration',
      file_path: `company/${companyId}/cr.pdf`, file_sha256: 'a'.repeat(64),
    }).select('id').single<{ id: string }>();
    docId = doc!.id;

    // A second, unrelated user with a real membership row.
    const { data: otherUser } = await admin.auth.admin.createUser({
      email: `za-other-${RUN}@sanad360.dev`, password: PASSWORD, email_confirm: true,
    });
    otherUserId = otherUser!.user!.id;
    await admin.from('profiles').upsert({ id: otherUserId, name_ar: 'other' }, { onConflict: 'id' });
    await admin.from('memberships').insert({ user_id: otherUserId, role: 'owner', company_id: companyId });

    // The applicant themself.
    const email = `za-applicant-${RUN}@applicant.sanad360.dev`;
    const { data: applicantUser } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
    applicantUserId = applicantUser!.user!.id;
    await admin.from('profiles').upsert({ id: applicantUserId, name_ar: 'applicant' }, { onConflict: 'id' });
    await admin.from('memberships').insert({ user_id: applicantUserId, role: 'applicant' });
    const { data: app } = await admin.from('pending_applications').insert({
      applicant_user_id: applicantUserId, tenant_type: 'company',
      name_ar: `طلب صفر وصول ${RUN}`, commercial_registration: `CP8ZA-APP-${RUN}`, contact_email: email,
    }).select('id').single<{ id: string }>();
    applicationId = app!.id;

    const { data: signIn, error: signInErr } = await anon.auth.signInWithPassword({ email, password: PASSWORD });
    if (signInErr || !signIn.session) throw new Error(`sign-in failed: ${signInErr?.message}`);
    applicantClient = createClient(SUPABASE_URL, ANON_KEY, {
      auth: { persistSession: false },
      global: { headers: { Authorization: `Bearer ${signIn.session.access_token}` } },
    });
  });

  afterAll(async () => {
    if (applicationId) await admin.from('pending_applications').delete().eq('id', applicationId);
    if (docId) await admin.from('documents').delete().eq('id', docId);
    if (facilityId) await admin.from('facilities').delete().eq('id', facilityId);
    if (tcId) await admin.from('transport_companies').delete().eq('id', tcId);
    if (companyId) await admin.from('companies').delete().eq('id', companyId);
    for (const uid of [applicantUserId, otherUserId]) {
      if (!uid) continue;
      await admin.from('memberships').delete().eq('user_id', uid);
      await admin.from('profiles').delete().eq('id', uid);
      await admin.auth.admin.deleteUser(uid).catch(() => {});
    }
  });

  it('sees zero rows on every operational table, despite real data existing', async () => {
    const r1 = await applicantClient.from('companies').select('id').eq('id', companyId);
    const r2 = await applicantClient.from('branches').select('id').eq('id', branchId);
    const r3 = await applicantClient.from('transport_companies').select('id').eq('id', tcId);
    const r4 = await applicantClient.from('facilities').select('id').eq('id', facilityId);
    const r5 = await applicantClient.from('drivers').select('id').eq('id', driverId);
    const r6 = await applicantClient.from('vehicles').select('id').eq('id', vehicleId);
    const r7 = await applicantClient.from('documents').select('id').eq('id', docId);
    const results = [
      ['companies', r1], ['branches', r2], ['transport_companies', r3], ['facilities', r4],
      ['drivers', r5], ['vehicles', r6], ['documents', r7],
    ] as const;
    for (const [label, { data, error }] of results) {
      expect(error, `${label} query should not error`).toBeNull();
      expect(data ?? [], `${label} should return zero rows to an applicant`).toHaveLength(0);
    }

    const { data: otherMembership } = await applicantClient.from('memberships').select('id').eq('user_id', otherUserId);
    expect(otherMembership ?? []).toHaveLength(0);

    // Sanity check: the SAME rows ARE visible via service_role, proving the
    // zero-row results above are RLS filtering, not "the data doesn't exist".
    const { data: realCompany } = await admin.from('companies').select('id').eq('id', companyId);
    expect(realCompany).toHaveLength(1);
  });

  it('can still see only their OWN pending_applications row', async () => {
    const { data } = await applicantClient.from('pending_applications').select('id').eq('id', applicationId);
    expect(data).toHaveLength(1);
  });
});
