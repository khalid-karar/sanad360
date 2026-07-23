/**
 * CP8 Slice D, gap 1 — recycler_manager role coverage.
 *
 * Found via the CP8 B audit: `recycler_manager` was exercised in ZERO
 * existing test files despite `facilities_update`, `facility_transporters_
 * insert`/`update` (migration 018), the facility branch of
 * `owns_document_target` (021, restored by 039), and services/pdf's
 * /admin/invite-recycler + /admin/facilities endpoints all having real
 * authorization logic gated on this exact role — none of it had ever been
 * exercised by a test.
 *
 * Assertions:
 *   1. facilities_update: a facility's own recycler_manager can update it;
 *      a DIFFERENT facility's recycler_manager cannot
 *   2. facility_transporters insert/update: same own-facility-only scoping
 *   3. Document upload for owner_type='facility': the facility's own
 *      recycler_manager can upload; the facility's own scale_operator
 *      CANNOT (owns_document_target's facility branch is recycler_manager-
 *      only, not "any facility member")
 *   4. POST /admin/facilities: admin-only — a recycler_manager gets 403
 *   5. POST /admin/invite-recycler: admin can invite a recycler_manager;
 *      a facility's own recycler_manager can invite a scale_operator for
 *      THEIR OWN facility but gets 403 inviting for a different facility,
 *      and 403 attempting to invite another recycler_manager at all
 *      (admin-only, per the endpoint's own stated policy); a scale_operator
 *      cannot invite anyone
 *
 * Skips automatically if the PDF service isn't reachable (assertions 4-5
 * only — assertions 1-3 are pure DB/RLS and always run).
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY ?? '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const PDF_SERVICE_URL = process.env.VITE_PDF_SERVICE_URL ?? 'http://localhost:3001';

if (!ANON_KEY || !SERVICE_KEY) {
  throw new Error('Set VITE_SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY in .env.');
}

const admin: SupabaseClient = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
const anon: SupabaseClient = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });

const RUN = Date.now();
const PASSWORD = 'DevPass1234!';

async function isPdfServiceUp(): Promise<boolean> {
  try {
    const res = await fetch(`${PDF_SERVICE_URL}/health`, { signal: AbortSignal.timeout(3_000) });
    return res.ok;
  } catch {
    return false;
  }
}

async function sessionClient(email: string): Promise<{ client: SupabaseClient; jwt: string }> {
  const { data, error } = await anon.auth.signInWithPassword({ email, password: PASSWORD });
  if (error || !data.session) throw new Error(`sign-in failed (${email}): ${error?.message}`);
  const jwt = data.session.access_token;
  return {
    client: createClient(SUPABASE_URL, ANON_KEY, {
      auth: { persistSession: false },
      global: { headers: { Authorization: `Bearer ${jwt}` } },
    }),
    jwt,
  };
}

async function createUserWithRole(
  emailPrefix: string,
  role: string,
  facilityId: string | null
): Promise<string> {
  const email = `${emailPrefix}-${RUN}@maya.sanad360.dev`;
  const { data: created, error } = await admin.auth.admin.createUser({
    email, password: PASSWORD, email_confirm: true,
  });
  if (error || !created.user) throw new Error(`createUser failed: ${error?.message}`);
  const userId = created.user.id;
  await admin.from('profiles').upsert({ id: userId, name_ar: emailPrefix }, { onConflict: 'id' });
  await admin.from('memberships').insert({ user_id: userId, role, facility_id: facilityId });
  return userId;
}

describe('CP8 D gap 1: recycler_manager RLS + endpoint coverage', () => {
  let facilityAId = '';
  let facilityBId = '';
  let recyclerManagerAId = '';
  let recyclerManagerBId = '';
  let scaleOperatorAId = '';
  let adminId = '';
  const cleanupUserIds: string[] = [];
  const cleanupFacilityIds: string[] = [];
  const cleanupDocIds: string[] = [];
  const cleanupTcIds: string[] = [];
  const cleanupLinkIds: string[] = [];
  const cleanupInvitedUserIds: string[] = [];

  let serviceUp = false;

  beforeAll(async () => {
    serviceUp = await isPdfServiceUp();

    const { data: fa } = await admin.from('facilities').insert({ name_ar: `منشأة أ ${RUN}` }).select('id').single<{ id: string }>();
    facilityAId = fa!.id;
    cleanupFacilityIds.push(facilityAId);
    const { data: fb } = await admin.from('facilities').insert({ name_ar: `منشأة ب ${RUN}` }).select('id').single<{ id: string }>();
    facilityBId = fb!.id;
    cleanupFacilityIds.push(facilityBId);

    recyclerManagerAId = await createUserWithRole('recman-a', 'recycler_manager', facilityAId);
    cleanupUserIds.push(recyclerManagerAId);
    recyclerManagerBId = await createUserWithRole('recman-b', 'recycler_manager', facilityBId);
    cleanupUserIds.push(recyclerManagerBId);
    scaleOperatorAId = await createUserWithRole('scaleop-a', 'scale_operator', facilityAId);
    cleanupUserIds.push(scaleOperatorAId);
    adminId = await createUserWithRole('admin-recy', 'admin', null);
    cleanupUserIds.push(adminId);
  });

  afterAll(async () => {
    if (cleanupInvitedUserIds.length) {
      await admin.from('memberships').delete().in('user_id', cleanupInvitedUserIds);
      for (const uid of cleanupInvitedUserIds) await admin.auth.admin.deleteUser(uid).catch(() => {});
    }
    if (cleanupDocIds.length) await admin.from('documents').delete().in('id', cleanupDocIds);
    if (cleanupLinkIds.length) await admin.from('facility_transporters').delete().in('id', cleanupLinkIds);
    if (cleanupTcIds.length) await admin.from('transport_companies').delete().in('id', cleanupTcIds);
    if (cleanupFacilityIds.length) await admin.from('facilities').delete().in('id', cleanupFacilityIds);
    for (const uid of cleanupUserIds) {
      await admin.from('memberships').delete().eq('user_id', uid);
      await admin.from('profiles').delete().eq('id', uid);
      await admin.auth.admin.deleteUser(uid).catch(() => {});
    }
  });

  it('1. facilities_update: own facility succeeds, a different facility is rejected', async () => {
    const { client: recManA } = await sessionClient(`recman-a-${RUN}@maya.sanad360.dev`);

    const { error: ownErr, data: ownData } = await recManA
      .from('facilities')
      .update({ city: 'Riyadh' })
      .eq('id', facilityAId)
      .select('id');
    expect(ownErr).toBeNull();
    expect(ownData).toHaveLength(1);

    // RLS UPDATE against a non-matching row filters it out silently (0 rows
    // affected, no error) rather than raising — assert zero rows changed.
    const { data: otherData, error: otherErr } = await recManA
      .from('facilities')
      .update({ city: 'Jeddah' })
      .eq('id', facilityBId)
      .select('id');
    expect(otherErr).toBeNull();
    expect(otherData ?? []).toHaveLength(0);

    const { data: check } = await admin.from('facilities').select('city').eq('id', facilityBId).single<{ city: string | null }>();
    expect(check!.city).not.toBe('Jeddah');
  });

  it('2. facility_transporters insert/update: own facility succeeds, a different facility is rejected', async () => {
    const { client: recManA } = await sessionClient(`recman-a-${RUN}@maya.sanad360.dev`);

    const { data: tc } = await admin
      .from('transport_companies')
      .insert({ name_ar: `ناقل اختبار ${RUN}`, commercial_registration: `CP8RM-${RUN}` })
      .select('id').single<{ id: string }>();
    cleanupTcIds.push(tc!.id);

    const { data: ownLink, error: ownLinkErr } = await recManA
      .from('facility_transporters')
      .insert({ facility_id: facilityAId, transport_company_id: tc!.id, status: 'active' })
      .select('id').single<{ id: string }>();
    expect(ownLinkErr).toBeNull();
    cleanupLinkIds.push(ownLink!.id);

    const { error: otherLinkErr } = await recManA
      .from('facility_transporters')
      .insert({ facility_id: facilityBId, transport_company_id: tc!.id, status: 'active' });
    expect(otherLinkErr).not.toBeNull();
    expect(otherLinkErr!.code).toBe('42501');

    const { data: updateOwn, error: updateOwnErr } = await recManA
      .from('facility_transporters')
      .update({ status: 'inactive' })
      .eq('id', ownLink!.id)
      .select('id');
    expect(updateOwnErr).toBeNull();
    expect(updateOwn).toHaveLength(1);
  });

  it('3. document upload for owner_type=facility: own recycler_manager can, own scale_operator cannot', async () => {
    const { client: recManA } = await sessionClient(`recman-a-${RUN}@maya.sanad360.dev`);
    const { client: scaleOpA } = await sessionClient(`scaleop-a-${RUN}@maya.sanad360.dev`);

    const { data: doc, error: docErr } = await recManA.from('documents').insert({
      owner_type: 'facility', owner_id: facilityAId, doc_type: 'commercial_registration',
      file_path: `facility/${facilityAId}/cr.pdf`, file_sha256: 'a'.repeat(64), uploaded_by: recyclerManagerAId,
    }).select('id').single<{ id: string }>();
    expect(docErr).toBeNull();
    cleanupDocIds.push(doc!.id);

    const { error: scaleOpErr } = await scaleOpA.from('documents').insert({
      owner_type: 'facility', owner_id: facilityAId, doc_type: 'operating_license',
      file_path: `facility/${facilityAId}/lic.pdf`, file_sha256: 'b'.repeat(64), uploaded_by: scaleOperatorAId,
    });
    expect(scaleOpErr).not.toBeNull();
    expect(scaleOpErr!.code).toBe('42501');
  });

  it('4. POST /admin/facilities is admin-only; a recycler_manager gets 403', async () => {
    if (!serviceUp) { console.log('SKIP: PDF service not running'); return; }
    const { jwt: adminJwt } = await sessionClient(`admin-recy-${RUN}@maya.sanad360.dev`);

    const resAdmin = await fetch(`${PDF_SERVICE_URL}/admin/facilities`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminJwt}` },
      body: JSON.stringify({ name_ar: `منشأة عبر النقطة ${RUN}` }),
    });
    expect(resAdmin.status).toBe(201);
    const created = await resAdmin.json() as { facility_id: string };
    cleanupFacilityIds.push(created.facility_id);

    const { jwt: recManJwt } = await sessionClient(`recman-a-${RUN}@maya.sanad360.dev`);
    const resRecMan = await fetch(`${PDF_SERVICE_URL}/admin/facilities`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${recManJwt}` },
      body: JSON.stringify({ name_ar: `يجب أن يفشل ${RUN}` }),
    });
    expect(resRecMan.status).toBe(403);
  });

  it('5. POST /admin/invite-recycler: role + own-facility scoping', async () => {
    if (!serviceUp) { console.log('SKIP: PDF service not running'); return; }
    const { jwt: adminJwt } = await sessionClient(`admin-recy-${RUN}@maya.sanad360.dev`);
    const { jwt: recManAJwt } = await sessionClient(`recman-a-${RUN}@maya.sanad360.dev`);
    const { jwt: scaleOpAJwt } = await sessionClient(`scaleop-a-${RUN}@maya.sanad360.dev`);

    async function invite(jwt: string, body: Record<string, unknown>) {
      return fetch(`${PDF_SERVICE_URL}/admin/invite-recycler`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
        body: JSON.stringify(body),
      });
    }

    // admin can invite a NEW recycler_manager for facility B.
    const resAdminInvite = await invite(adminJwt, {
      facility_id: facilityBId, role: 'recycler_manager',
      email: `new-recman-b-${RUN}@maya.sanad360.dev`, temp_password: 'DevPass1234!', name_ar: 'مدير جديد',
    });
    expect(resAdminInvite.status).toBe(201);
    const adminInvited = await resAdminInvite.json() as { user_id: string };
    cleanupInvitedUserIds.push(adminInvited.user_id);

    // recycler_manager A can invite a scale_operator for THEIR OWN facility.
    const resOwnScaleOp = await invite(recManAJwt, {
      facility_id: facilityAId, role: 'scale_operator',
      email: `new-scaleop-a-${RUN}@maya.sanad360.dev`, temp_password: 'DevPass1234!', name_ar: 'مشغل ميزان جديد',
    });
    expect(resOwnScaleOp.status).toBe(201);
    const scaleOpInvited = await resOwnScaleOp.json() as { user_id: string };
    cleanupInvitedUserIds.push(scaleOpInvited.user_id);

    // recycler_manager A CANNOT invite for facility B (different facility).
    const resCrossFacility = await invite(recManAJwt, {
      facility_id: facilityBId, role: 'scale_operator',
      email: `should-fail-${RUN}@maya.sanad360.dev`, temp_password: 'DevPass1234!', name_ar: 'يجب أن يفشل',
    });
    expect(resCrossFacility.status).toBe(403);

    // recycler_manager A cannot invite ANOTHER recycler_manager, even for their own facility.
    const resPeerRecMan = await invite(recManAJwt, {
      facility_id: facilityAId, role: 'recycler_manager',
      email: `should-also-fail-${RUN}@maya.sanad360.dev`, temp_password: 'DevPass1234!', name_ar: 'يجب أن يفشل أيضاً',
    });
    expect(resPeerRecMan.status).toBe(403);

    // scale_operator cannot invite anyone.
    const resScaleOpInvite = await invite(scaleOpAJwt, {
      facility_id: facilityAId, role: 'scale_operator',
      email: `should-fail-too-${RUN}@maya.sanad360.dev`, temp_password: 'DevPass1234!', name_ar: 'يجب أن يفشل كذلك',
    });
    expect(resScaleOpInvite.status).toBe(403);
  });
});
