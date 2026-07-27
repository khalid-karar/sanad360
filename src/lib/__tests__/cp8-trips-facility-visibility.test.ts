/**
 * CP8 Slice D, gap 3 — trips_select's facility-visibility branch.
 *
 * Found via the B audit: trips_select (018) includes
 * `planned_facility_id = my_membership().facility_id` — the receiving
 * facility can see a trip planned for them — but no existing test file
 * combines a facility-scoped client with the trips table at all (trip-
 * ownership.test.ts only ever uses transport-side roles).
 *
 * Also confirms the read/write asymmetry: trips_update (018) has NO
 * facility branch at all — a facility can SEE a trip planned for them but
 * cannot modify it.
 *
 * Assertions:
 *   1. The receiving facility's recycler_manager can SELECT a trip planned
 *      for their facility
 *   2. A DIFFERENT (unrelated) facility's recycler_manager sees zero rows
 *      for that same trip
 *   3. The receiving facility's recycler_manager CANNOT UPDATE the trip
 *      (view-only — no facility branch on trips_update)
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { grandfatherCompliance } from './testHelpers/complianceExempt';

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

describe('CP8 D gap 3: trips_select facility-visibility branch', () => {
  let tcId = '';
  let driverId = '';
  let vehicleId = '';
  let facilityReceivingId = '';
  let facilityOtherId = '';
  let tripId = '';
  let receivingFacilityClient: SupabaseClient;
  let otherFacilityClient: SupabaseClient;
  const cleanupUserIds: string[] = [];
  const cleanupFacilityIds: string[] = [];
  const cleanupTcIds: string[] = [];

  beforeAll(async () => {
    const { data: tc } = await admin.from('transport_companies').insert({
      name_ar: `ناقل رحلات ${RUN}`, commercial_registration: `CP8TRIP-${RUN}`,
    }).select('id').single<{ id: string }>();
    tcId = tc!.id; cleanupTcIds.push(tcId);
    grandfatherCompliance('transport_company', tcId);

    const { data: driver } = await admin.from('drivers').insert({
      transport_company_id: tcId, name_ar: 'سائق رحلة', license_number: `CP8TRIP-DRV-${RUN}`, license_expiry: '2030-01-01',
    }).select('id').single<{ id: string }>();
    driverId = driver!.id;
    grandfatherCompliance('driver', driverId);

    const { data: vehicle } = await admin.from('vehicles').insert({
      transport_company_id: tcId, plate_number: `CP8TRIP-${RUN}`, type: 'medium_truck', waste_license_type: 'general',
      ncwm_license_number: `CP8TRIP-VEH-${RUN}`, ncwm_license_expiry: '2030-01-01',
    }).select('id').single<{ id: string }>();
    vehicleId = vehicle!.id;
    grandfatherCompliance('vehicle', vehicleId);

    const { data: facReceiving } = await admin.from('facilities').insert({ name_ar: `منشأة استقبال ${RUN}` }).select('id').single<{ id: string }>();
    facilityReceivingId = facReceiving!.id; cleanupFacilityIds.push(facilityReceivingId);
    const { data: facOther } = await admin.from('facilities').insert({ name_ar: `منشأة أخرى ${RUN}` }).select('id').single<{ id: string }>();
    facilityOtherId = facOther!.id; cleanupFacilityIds.push(facilityOtherId);

    await admin.from('facility_transporters').insert({
      facility_id: facilityReceivingId, transport_company_id: tcId, status: 'active',
    });

    const { data: trip } = await admin.from('trips').insert({
      transport_company_id: tcId, driver_id: driverId, vehicle_id: vehicleId,
      planned_facility_id: facilityReceivingId, waste_stream: 'organic',
      trip_date: new Date().toISOString().slice(0, 10),
    }).select('id').single<{ id: string }>();
    tripId = trip!.id;

    async function makeRecyclerManager(emailPrefix: string, facilityId: string): Promise<SupabaseClient> {
      const email = `${emailPrefix}-${RUN}@maya.sanad360.dev`;
      const { data: created } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
      const userId = created!.user!.id;
      cleanupUserIds.push(userId);
      await admin.from('profiles').upsert({ id: userId, name_ar: emailPrefix }, { onConflict: 'id' });
      await admin.from('memberships').insert({ user_id: userId, role: 'recycler_manager', facility_id: facilityId });
      return sessionClient(email);
    }

    receivingFacilityClient = await makeRecyclerManager('trip-fac-receiving', facilityReceivingId);
    otherFacilityClient = await makeRecyclerManager('trip-fac-other', facilityOtherId);
  });

  afterAll(async () => {
    if (tripId) await admin.from('trips').delete().eq('id', tripId);
    if (cleanupFacilityIds.length) await admin.from('facilities').delete().in('id', cleanupFacilityIds);
    if (cleanupTcIds.length) await admin.from('transport_companies').delete().in('id', cleanupTcIds);
    for (const uid of cleanupUserIds) {
      await admin.from('memberships').delete().eq('user_id', uid);
      await admin.from('profiles').delete().eq('id', uid);
      await admin.auth.admin.deleteUser(uid).catch(() => {});
    }
  });

  it('1. the receiving facility can SELECT the trip planned for them', async () => {
    const { data } = await receivingFacilityClient.from('trips').select('id').eq('id', tripId);
    expect(data).toHaveLength(1);
  });

  it('2. an unrelated facility sees zero rows for that trip', async () => {
    const { data } = await otherFacilityClient.from('trips').select('id').eq('id', tripId);
    expect(data ?? []).toHaveLength(0);
  });

  it('3. the receiving facility cannot UPDATE the trip (view-only)', async () => {
    const { data } = await receivingFacilityClient.from('trips').update({ waste_stream: 'plastic' }).eq('id', tripId).select('id');
    expect(data ?? []).toHaveLength(0);

    const { data: check } = await admin.from('trips').select('waste_stream').eq('id', tripId).single<{ waste_stream: string }>();
    expect(check!.waste_stream).toBe('organic');
  });
});
