/**
 * CP8 Slice H — cross-tenant storage isolation for two buckets
 * storage-tenant-isolation.test.ts never directly exercises:
 * `compliance-documents` (migration 021) and `weighbridge-photos`
 * (migration 018). Both share the same policy SHAPE already proven for
 * `pickup-photos`/`inspection-pdfs` (a SECURITY DEFINER prefix-check
 * function gating INSERT/SELECT on `storage.objects`, append-only via
 * migration 005's bucket-agnostic no-UPDATE/no-DELETE policies) — but
 * "same shape" was never actually run against these two buckets before.
 *
 * Real signed-in users (anon key + JWT) throughout; service_role only for
 * fixture setup/teardown.
 *
 * Assertions:
 *   1. compliance-documents: outsider (different company) CANNOT download
 *      company A's uploaded document.
 *   2. compliance-documents: outsider CANNOT upload into company A's
 *      {owner_type}/{owner_id}/ prefix (path squatting).
 *   3. compliance-documents: company A's own manager CAN download it.
 *   4. weighbridge-photos: an unrelated facility's scale_operator CANNOT
 *      download a photo filed under a DIFFERENT facility's trip.
 *   5. weighbridge-photos: the RECEIVING facility's own scale_operator CAN
 *      download it.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { grandfatherCompliance } from './testHelpers/complianceExempt';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY ?? '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
if (!ANON_KEY || !SERVICE_KEY) throw new Error('Set VITE_SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY in .env.');

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

describe('CP8 Slice H: cross-tenant storage isolation — compliance-documents + weighbridge-photos', () => {
  // ── compliance-documents fixtures ──────────────────────────────────────
  let companyAId = '';
  let companyAManagerId = '';
  let companyAManagerClient: SupabaseClient;
  let companyBManagerId = '';
  let companyBManagerClient: SupabaseClient;
  const docBytes = new TextEncoder().encode(`compliance-doc-${RUN}`);
  let docPath = '';

  // ── weighbridge-photos fixtures ────────────────────────────────────────
  let facilityAId = '';
  let facilityBId = '';
  let scaleOpAUserId = '';
  let scaleOpAClient: SupabaseClient;
  let scaleOpBUserId = '';
  let scaleOpBClient: SupabaseClient;
  let transportCompanyId = '';
  let driverId = '';
  let vehicleId = '';
  let tripAId = '';
  const weighbridgeBytes = new TextEncoder().encode(`weighbridge-photo-${RUN}`);
  let weighbridgePath = '';

  beforeAll(async () => {
    // ── company A + B, each with a real manager ──
    const { data: companyA } = await admin.from('companies')
      .insert({ name_ar: `شركة مستندات أ ${RUN}`, commercial_registration: `CP8SB-A-${RUN}` })
      .select('id').single<{ id: string }>();
    companyAId = companyA!.id;
    const { data: companyB } = await admin.from('companies')
      .insert({ name_ar: `شركة مستندات ب ${RUN}`, commercial_registration: `CP8SB-B-${RUN}` })
      .select('id').single<{ id: string }>();
    const companyBId = companyB!.id;

    const { data: userA } = await admin.auth.admin.createUser({
      email: `cp8sb-mgr-a-${RUN}@sanad360.dev`, password: PASSWORD, email_confirm: true,
    });
    companyAManagerId = userA!.user!.id;
    await admin.from('profiles').upsert({ id: companyAManagerId, name_ar: 'مدير أ' }, { onConflict: 'id' });
    await admin.from('memberships').insert({ user_id: companyAManagerId, role: 'manager', company_id: companyAId });

    const { data: userB } = await admin.auth.admin.createUser({
      email: `cp8sb-mgr-b-${RUN}@sanad360.dev`, password: PASSWORD, email_confirm: true,
    });
    companyBManagerId = userB!.user!.id;
    await admin.from('profiles').upsert({ id: companyBManagerId, name_ar: 'مدير ب' }, { onConflict: 'id' });
    await admin.from('memberships').insert({ user_id: companyBManagerId, role: 'manager', company_id: companyBId });

    docPath = `company/${companyAId}/commercial_registration-${RUN}.bin`;
    const { error: docUploadErr } = await admin.storage
      .from('compliance-documents')
      .upload(docPath, docBytes, { upsert: false, contentType: 'application/octet-stream' });
    if (docUploadErr) throw new Error(`compliance-documents fixture upload failed: ${docUploadErr.message}`);

    [companyAManagerClient, companyBManagerClient] = await Promise.all([
      sessionClient(`cp8sb-mgr-a-${RUN}@sanad360.dev`),
      sessionClient(`cp8sb-mgr-b-${RUN}@sanad360.dev`),
    ]);

    // ── two facilities, one transport company, a trip into facility A ──
    const { data: facA } = await admin.from('facilities')
      .insert({ name_ar: `منشأة أ ${RUN}` }).select('id').single<{ id: string }>();
    facilityAId = facA!.id;
    const { data: facB } = await admin.from('facilities')
      .insert({ name_ar: `منشأة ب ${RUN}` }).select('id').single<{ id: string }>();
    facilityBId = facB!.id;

    const { data: tc } = await admin.from('transport_companies')
      .insert({ name_ar: `شركة نقل الميزان ${RUN}`, commercial_registration: `CP8SB-TC-${RUN}` })
      .select('id').single<{ id: string }>();
    transportCompanyId = tc!.id;
    // This suite isn't exercising migration 042's tenant-block gate —
    // grandfather it so trips_before_insert() doesn't reject the fixture.
    grandfatherCompliance('transport_company', transportCompanyId);

    const { data: drv } = await admin.from('drivers').insert({
      transport_company_id: transportCompanyId, name_ar: 'سائق الميزان', license_number: `CP8SB-DL-${RUN}`,
      license_expiry: '2030-01-01', status: 'active',
    }).select('id').single<{ id: string }>();
    driverId = drv!.id;
    const { data: veh } = await admin.from('vehicles').insert({
      transport_company_id: transportCompanyId, plate_number: `CP8SB-${RUN}`, type: 'small_truck',
      waste_license_type: 'general', ncwm_license_expiry: '2030-01-01', status: 'active',
    }).select('id').single<{ id: string }>();
    vehicleId = veh!.id;

    // trips_before_insert() requires an ACTIVE facility_transporters link,
    // not just FK existence.
    await admin.from('facility_transporters').insert({
      transport_company_id: transportCompanyId, facility_id: facilityAId, status: 'active',
    });

    const { data: trip } = await admin.from('trips').insert({
      transport_company_id: transportCompanyId, driver_id: driverId, vehicle_id: vehicleId,
      planned_facility_id: facilityAId, waste_stream: 'plastic',
    }).select('id').single<{ id: string }>();
    tripAId = trip!.id;

    const { data: scaleA } = await admin.auth.admin.createUser({
      email: `cp8sb-scale-a-${RUN}@sanad360.dev`, password: PASSWORD, email_confirm: true,
    });
    scaleOpAUserId = scaleA!.user!.id;
    await admin.from('profiles').upsert({ id: scaleOpAUserId, name_ar: 'مشغل ميزان أ' }, { onConflict: 'id' });
    await admin.from('memberships').insert({ user_id: scaleOpAUserId, role: 'scale_operator', facility_id: facilityAId });

    const { data: scaleB } = await admin.auth.admin.createUser({
      email: `cp8sb-scale-b-${RUN}@sanad360.dev`, password: PASSWORD, email_confirm: true,
    });
    scaleOpBUserId = scaleB!.user!.id;
    await admin.from('profiles').upsert({ id: scaleOpBUserId, name_ar: 'مشغل ميزان ب' }, { onConflict: 'id' });
    await admin.from('memberships').insert({ user_id: scaleOpBUserId, role: 'scale_operator', facility_id: facilityBId });

    weighbridgePath = `${facilityAId}/${tripAId}/photo-${RUN}.bin`;
    const { error: wbUploadErr } = await admin.storage
      .from('weighbridge-photos')
      .upload(weighbridgePath, weighbridgeBytes, { upsert: false, contentType: 'application/octet-stream' });
    if (wbUploadErr) throw new Error(`weighbridge-photos fixture upload failed: ${wbUploadErr.message}`);

    [scaleOpAClient, scaleOpBClient] = await Promise.all([
      sessionClient(`cp8sb-scale-a-${RUN}@sanad360.dev`),
      sessionClient(`cp8sb-scale-b-${RUN}@sanad360.dev`),
    ]);
  });

  afterAll(async () => {
    await admin.storage.from('compliance-documents').remove([docPath]);
    await admin.storage.from('weighbridge-photos').remove([weighbridgePath]);
    for (const uid of [companyAManagerId, companyBManagerId, scaleOpAUserId, scaleOpBUserId]) {
      await admin.from('memberships').delete().eq('user_id', uid);
      await admin.from('profiles').delete().eq('id', uid);
      await admin.auth.admin.deleteUser(uid).catch(() => {});
    }
    if (tripAId) await admin.from('trips').delete().eq('id', tripAId);
    if (vehicleId) await admin.from('vehicles').delete().eq('id', vehicleId);
    if (driverId) await admin.from('drivers').delete().eq('id', driverId);
    if (transportCompanyId) await admin.from('transport_companies').delete().eq('id', transportCompanyId);
    if (facilityAId) await admin.from('facilities').delete().eq('id', facilityAId);
    if (facilityBId) await admin.from('facilities').delete().eq('id', facilityBId);
    if (companyAId) await admin.from('companies').delete().eq('id', companyAId);
  });

  it("1. compliance-documents: outsider (company B) CANNOT download company A's document", async () => {
    const { data, error } = await companyBManagerClient.storage.from('compliance-documents').download(docPath);
    expect(data).toBeNull();
    expect(error).not.toBeNull();
  });

  it("2. compliance-documents: outsider CANNOT upload into company A's owner prefix", async () => {
    const squatPath = `company/${companyAId}/squat-${RUN}.bin`;
    const { error } = await companyBManagerClient.storage
      .from('compliance-documents')
      .upload(squatPath, docBytes, { upsert: false });
    expect(error).not.toBeNull();
    const { data } = await admin.storage.from('compliance-documents').list(`company/${companyAId}`, { search: `squat-${RUN}` });
    expect(data ?? []).toHaveLength(0);
  });

  it('3. compliance-documents: company A member CAN download its own document', async () => {
    const { data, error } = await companyAManagerClient.storage.from('compliance-documents').download(docPath);
    expect(error).toBeNull();
    expect(data).not.toBeNull();
    expect(await data!.text()).toBe(`compliance-doc-${RUN}`);
  });

  it("4. weighbridge-photos: an unrelated facility's scale_operator CANNOT download another facility's trip photo", async () => {
    const { data, error } = await scaleOpBClient.storage.from('weighbridge-photos').download(weighbridgePath);
    expect(data).toBeNull();
    expect(error).not.toBeNull();
  });

  it('5. weighbridge-photos: the receiving facility\'s own scale_operator CAN download it', async () => {
    const { data, error } = await scaleOpAClient.storage.from('weighbridge-photos').download(weighbridgePath);
    expect(error).toBeNull();
    expect(data).not.toBeNull();
    expect(await data!.text()).toBe(`weighbridge-photo-${RUN}`);
  });
});
