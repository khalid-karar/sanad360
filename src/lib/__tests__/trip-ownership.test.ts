/**
 * Trip ownership (migrations 018 + 019)
 *
 * Design: only the TRANSPORT COMPANY plans a trip; the company/generator side
 * requests/schedules a pickup (pickup_assignments) and never creates or owns
 * a trip. All assertions run as REAL signed-in users; service_role is used
 * for setup/teardown only.
 *
 * Assertions:
 *   1. A company user CANNOT insert into trips (trips_insert RLS)
 *   2. A transport manager/dispatcher CAN create a trip for their own fleet
 *   3. A company user CANNOT set trip_id on their own pickup_assignments row
 *      (pickup_assignments_trip_link_guard), even though their existing
 *      UPDATE policy otherwise lets them touch that row
 *   4. The trip's own transport dispatcher CAN link/unlink one of their
 *      fleet's pending pickup requests into the trip
 *   5. A DIFFERENT transport company's dispatcher cannot link an assignment
 *      into a trip they don't own
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
  companyId:           'a0000000-0000-0000-0000-000000000001',
  branchId:            'b0000000-0000-0000-0000-000000000001',
  transportCompanyId:  'c0000000-0000-0000-0000-000000000001',
  driverId:            'd0000000-0000-0000-0000-000000000001',
  vehicleId:           'e0000000-0000-0000-0000-000000000001',
  facilityId:          '90000000-0000-0000-0000-000000000001',
  companyManagerEmail: 'manager@sanad360.dev',
  transportManagerEmail: 'transport.manager@sanad360.dev',
  password:            'DevPass1234!',
};

const RUN = Date.now();

async function sessionClient(email: string, password: string): Promise<SupabaseClient> {
  const { data, error } = await anon.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${data.session!.access_token}` } },
  });
}

describe('Trip ownership (migrations 018 + 019)', () => {
  let companyClient: SupabaseClient;
  let transportClient: SupabaseClient;
  let outsiderTransportClient: SupabaseClient;

  let tripId = '';
  let assignmentId = '';
  let outsiderTransportCompanyId = '';
  let outsiderUserId = '';
  let outsiderDriverId = '';
  let outsiderVehicleId = '';

  const cleanupTripIds: string[] = [];
  const cleanupAssignmentIds: string[] = [];

  beforeAll(async () => {
    [companyClient, transportClient] = await Promise.all([
      sessionClient(SEED.companyManagerEmail, SEED.password),
      sessionClient(SEED.transportManagerEmail, SEED.password),
    ]);

    // The trip this test exercises — created via service_role for setup
    // (mirrors the pattern used elsewhere; the "transport CAN create" case
    // is asserted separately below via a real client insert).
    const { data: trip } = await admin
      .from('trips')
      .insert({
        transport_company_id: SEED.transportCompanyId,
        driver_id: SEED.driverId,
        vehicle_id: SEED.vehicleId,
        planned_facility_id: SEED.facilityId,
        waste_stream: 'plastic',
      })
      .select('id')
      .single<{ id: string }>();
    tripId = trip!.id;
    cleanupTripIds.push(tripId);

    // A pending pickup request from the company, served by the seeded driver.
    const { data: assignment } = await admin
      .from('pickup_assignments')
      .insert({
        company_id: SEED.companyId,
        branch_id: SEED.branchId,
        driver_id: SEED.driverId,
        vehicle_id: SEED.vehicleId,
        scheduled_at: new Date(Date.now() + 86400000).toISOString(),
        status: 'pending',
      })
      .select('id')
      .single<{ id: string }>();
    assignmentId = assignment!.id;
    cleanupAssignmentIds.push(assignmentId);

    // A second, unrelated transport company + its own dispatcher, driver and
    // vehicle — for the cross-tenant link-denial assertion.
    const { data: tc2 } = await admin
      .from('transport_companies')
      .insert({ name_ar: `شركة نقل عزل ${RUN}`, commercial_registration: `CR-TRIP-${RUN}` })
      .select('id')
      .single<{ id: string }>();
    outsiderTransportCompanyId = tc2!.id;

    const { data: d2 } = await admin
      .from('drivers')
      .insert({
        transport_company_id: outsiderTransportCompanyId,
        name_ar: 'سائق معزول',
        license_number: `TRIP-${RUN}`,
        license_expiry: '2030-01-01',
      })
      .select('id')
      .single<{ id: string }>();
    outsiderDriverId = d2!.id;

    const { data: v2 } = await admin
      .from('vehicles')
      .insert({
        transport_company_id: outsiderTransportCompanyId,
        plate_number: `TRIP-${RUN}`,
        type: 'medium_truck',
        waste_license_type: 'general',
        ncwm_license_expiry: '2030-01-01',
      })
      .select('id')
      .single<{ id: string }>();
    outsiderVehicleId = v2!.id;

    const OUTSIDER_EMAIL = `trip-outsider-${RUN}@sanad360.dev`;
    const { data: created } = await admin.auth.admin.createUser({
      email: OUTSIDER_EMAIL,
      password: 'DevPass1234!',
      email_confirm: true,
    });
    outsiderUserId = created.user!.id;
    await admin.from('memberships').insert({
      user_id: outsiderUserId,
      role: 'manager',
      transport_company_id: outsiderTransportCompanyId,
    });
    outsiderTransportClient = await sessionClient(OUTSIDER_EMAIL, 'DevPass1234!');
  });

  afterAll(async () => {
    for (const id of cleanupAssignmentIds) await admin.from('pickup_assignments').delete().eq('id', id);
    for (const id of cleanupTripIds) await admin.from('trips').delete().eq('id', id);
    if (outsiderUserId) {
      await admin.from('memberships').delete().eq('user_id', outsiderUserId);
      await admin.from('profiles').delete().eq('id', outsiderUserId);
      await admin.auth.admin.deleteUser(outsiderUserId);
    }
    if (outsiderDriverId) await admin.from('drivers').delete().eq('id', outsiderDriverId);
    if (outsiderVehicleId) await admin.from('vehicles').delete().eq('id', outsiderVehicleId);
    if (outsiderTransportCompanyId) await admin.from('transport_companies').delete().eq('id', outsiderTransportCompanyId);
  });

  it('1. a company user CANNOT create a trip', async () => {
    const { error } = await companyClient.from('trips').insert({
      transport_company_id: SEED.transportCompanyId,
      driver_id: SEED.driverId,
      vehicle_id: SEED.vehicleId,
      planned_facility_id: SEED.facilityId,
      waste_stream: 'plastic',
    });
    expect(error).not.toBeNull();
  });

  it('2. a transport manager CAN create a trip for their own fleet', async () => {
    const { data: { user } } = await transportClient.auth.getUser();
    const { data, error } = await transportClient
      .from('trips')
      .insert({
        transport_company_id: SEED.transportCompanyId,
        driver_id: SEED.driverId,
        vehicle_id: SEED.vehicleId,
        planned_facility_id: SEED.facilityId,
        waste_stream: 'organic',
        created_by: user!.id,
      })
      .select('id')
      .single<{ id: string }>();
    expect(error).toBeNull();
    cleanupTripIds.push(data!.id);
  });

  it('3. a company user CANNOT set trip_id on their own pickup_assignments row', async () => {
    const { error } = await companyClient
      .from('pickup_assignments')
      .update({ trip_id: tripId })
      .eq('id', assignmentId);
    expect(error).not.toBeNull();

    const { data: still } = await admin
      .from('pickup_assignments')
      .select('trip_id')
      .eq('id', assignmentId)
      .single<{ trip_id: string | null }>();
    expect(still?.trip_id).toBeNull();
  });

  it('4. the trip\'s own transport dispatcher CAN link then unlink a pending request', async () => {
    const { error: linkErr } = await transportClient
      .from('pickup_assignments')
      .update({ trip_id: tripId })
      .eq('id', assignmentId);
    expect(linkErr).toBeNull();

    const { data: linked } = await admin
      .from('pickup_assignments')
      .select('trip_id')
      .eq('id', assignmentId)
      .single<{ trip_id: string | null }>();
    expect(linked?.trip_id).toBe(tripId);

    const { error: unlinkErr } = await transportClient
      .from('pickup_assignments')
      .update({ trip_id: null })
      .eq('id', assignmentId);
    expect(unlinkErr).toBeNull();

    const { data: unlinked } = await admin
      .from('pickup_assignments')
      .select('trip_id')
      .eq('id', assignmentId)
      .single<{ trip_id: string | null }>();
    expect(unlinked?.trip_id).toBeNull();
  });

  it('5. a DIFFERENT transport company cannot link an assignment into this trip', async () => {
    // The outsider's fleet doesn't own this assignment's driver, so RLS
    // simply won't match the row (0 rows affected, no error) — the real
    // assertion is that trip_id never changes, checked via service_role below.
    await outsiderTransportClient
      .from('pickup_assignments')
      .update({ trip_id: tripId })
      .eq('id', assignmentId);

    const { data: still } = await admin
      .from('pickup_assignments')
      .select('trip_id')
      .eq('id', assignmentId)
      .single<{ trip_id: string | null }>();
    expect(still?.trip_id).toBeNull();
  });

  it('6. transport-side callers cannot change other fields via the trip-link path', async () => {
    const { error } = await transportClient
      .from('pickup_assignments')
      .update({ trip_id: tripId, notes: 'rewritten by transport' })
      .eq('id', assignmentId);
    expect(error).not.toBeNull();

    const { data: still } = await admin
      .from('pickup_assignments')
      .select('trip_id, notes')
      .eq('id', assignmentId)
      .single<{ trip_id: string | null; notes: string | null }>();
    expect(still?.trip_id).toBeNull();
    expect(still?.notes).not.toBe('rewritten by transport');
  });
});
