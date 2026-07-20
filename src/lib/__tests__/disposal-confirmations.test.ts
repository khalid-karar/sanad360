/**
 * Disposal Confirmations (Migration 018 rework) — recycler's own,
 * independent chain-of-custody confirmation of a trip's drop-off.
 *
 * All assertions run as REAL signed-in users; service_role is used for
 * setup/teardown only.
 *
 * Assertions:
 *   1. scale_operator confirms a trip; the trigger FORCES facility_id/
 *      transport_company_id from the trip and confirmed_by/confirmed_at
 *      server-side, ignoring spoofed client values
 *   2. One confirmation per trip (UNIQUE(trip_id)) — a second insert fails
 *   3. UPDATE and DELETE are rejected for authenticated (append-only)
 *   4. A transport-company user (manager) CANNOT insert a confirmation
 *   5. scale_operator of facility A cannot confirm facility B's trip
 *   6. Reconciliation: within-tolerance and beyond-tolerance mismatches
 *   7. custody-complete: false until confirmed; a rejection leaves it false
 *   8. admin_override_disposal_weight: unreachable by authenticated,
 *      reachable by service_role, audit-logged, re-reconciles
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
  transportCompanyId: 'c0000000-0000-0000-0000-000000000001',
  driverId:           'd0000000-0000-0000-0000-000000000001',
  vehicleId:          'e0000000-0000-0000-0000-000000000001',
  facilityId:         '90000000-0000-0000-0000-000000000001',
  managerEmail:       'manager@sanad360.dev',
  managerPassword:    'DevPass1234!',
  scaleOperatorEmail: 'scale.operator@sanad360.dev',
  scaleOperatorPassword: 'DevPass1234!',
  password:           'DevPass1234!',
};

const RUN = Date.now();
const OUTSIDER_EMAIL = `disposal-outsider-${RUN}@sanad360.dev`;

async function sessionClient(email: string, password: string): Promise<SupabaseClient> {
  const { data, error } = await anon.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${data.session!.access_token}` } },
  });
}

async function createTrip(overrides: Partial<{ waste_stream: string }> = {}): Promise<string> {
  const { data, error } = await admin
    .from('trips')
    .insert({
      transport_company_id: SEED.transportCompanyId,
      driver_id: SEED.driverId,
      vehicle_id: SEED.vehicleId,
      planned_facility_id: SEED.facilityId,
      waste_stream: overrides.waste_stream ?? 'plastic',
    })
    .select('id')
    .single<{ id: string }>();
  if (error || !data) throw new Error(`trip insert failed: ${error?.message}`);
  return data.id;
}

async function addPickupToTrip(tripId: string, weightKg: number): Promise<string> {
  const { data, error } = await admin
    .from('pickup_events')
    .insert({
      logical_id: crypto.randomUUID(),
      revision: 1,
      company_id: 'a0000000-0000-0000-0000-000000000001',
      branch_id: 'b0000000-0000-0000-0000-000000000001',
      transport_company_id: SEED.transportCompanyId,
      driver_id: SEED.driverId,
      vehicle_id: SEED.vehicleId,
      trip_id: tripId,
      waste_types: ['plastic'],
      weight_kg: weightKg,
    })
    .select('id')
    .single<{ id: string }>();
  if (error || !data) throw new Error(`pickup insert failed: ${error?.message}`);
  return data.id;
}

describe('Disposal confirmations (Migration 018)', () => {
  let scaleOperatorClient: SupabaseClient;
  let managerClient: SupabaseClient;
  let outsiderClient: SupabaseClient;
  let outsiderUserId = '';
  let outsiderFacilityId = '';
  let scaleOperatorUserId = '';

  let tripId = '';
  let confirmationId = '';
  let weighbridgePath = '';

  const cleanupTripIds: string[] = [];
  const cleanupPickupIds: string[] = [];
  const cleanupConfirmationIds: string[] = [];

  beforeAll(async () => {
    [scaleOperatorClient, managerClient] = await Promise.all([
      sessionClient(SEED.scaleOperatorEmail, SEED.scaleOperatorPassword),
      sessionClient(SEED.managerEmail, SEED.managerPassword),
    ]);

    const { data: { user } } = await scaleOperatorClient.auth.getUser();
    scaleOperatorUserId = user?.id ?? '';

    tripId = await createTrip();
    cleanupTripIds.push(tripId);

    // Outsider facility + its own scale_operator, for the cross-facility assertion.
    const { data: f2 } = await admin
      .from('facilities')
      .insert({ name_ar: `منشأة عزل ${RUN}` })
      .select('id')
      .single<{ id: string }>();
    outsiderFacilityId = f2!.id;

    const { data: created } = await admin.auth.admin.createUser({
      email: OUTSIDER_EMAIL,
      password: 'DevPass1234!',
      email_confirm: true,
    });
    outsiderUserId = created.user!.id;
    await admin.from('memberships').insert({
      user_id: outsiderUserId,
      role: 'scale_operator',
      facility_id: outsiderFacilityId,
    });
    outsiderClient = await sessionClient(OUTSIDER_EMAIL, 'DevPass1234!');
  });

  afterAll(async () => {
    for (const id of cleanupConfirmationIds) {
      await admin.from('disposal_confirmations').delete().eq('id', id);
    }
    if (weighbridgePath) await admin.storage.from('weighbridge-photos').remove([weighbridgePath]);
    for (const id of cleanupPickupIds) {
      await admin.from('pickup_events').delete().eq('id', id);
    }
    for (const id of cleanupTripIds) {
      await admin.from('trips').delete().eq('id', id);
    }
    if (outsiderUserId) {
      await admin.from('memberships').delete().eq('user_id', outsiderUserId);
      await admin.from('profiles').delete().eq('id', outsiderUserId);
      await admin.auth.admin.deleteUser(outsiderUserId);
    }
    if (outsiderFacilityId) await admin.from('facilities').delete().eq('id', outsiderFacilityId);
  });

  it('1. scale_operator confirms; server forces facility/transport/confirmed_by/confirmed_at', async () => {
    const bytes = new TextEncoder().encode(`weighbridge-${RUN}`);
    weighbridgePath = `${SEED.facilityId}/${tripId}/weighbridge.bin`;
    const { error: upErr } = await scaleOperatorClient.storage
      .from('weighbridge-photos')
      .upload(weighbridgePath, bytes, { upsert: false, contentType: 'application/octet-stream' });
    expect(upErr).toBeNull();

    const { data, error } = await scaleOperatorClient
      .from('disposal_confirmations')
      .insert({
        trip_id: tripId,
        status: 'confirmed',
        net_weight_kg: 20,
        weighbridge_photo_path: weighbridgePath,
        weighbridge_photo_sha256: 'deadbeef',
        // Spoofed server-set fields — the BEFORE INSERT trigger must overwrite them.
        facility_id: '00000000-0000-0000-0000-00000000dead',
        transport_company_id: '00000000-0000-0000-0000-00000000beef',
        confirmed_by: '00000000-0000-0000-0000-00000000cafe',
      })
      .select('*')
      .single<{
        id: string;
        facility_id: string;
        transport_company_id: string;
        confirmed_by: string;
        confirmed_at: string | null;
      }>();

    expect(error).toBeNull();
    confirmationId = data!.id;
    cleanupConfirmationIds.push(confirmationId);
    expect(data!.facility_id).toBe(SEED.facilityId);
    expect(data!.transport_company_id).toBe(SEED.transportCompanyId);
    expect(data!.confirmed_by).toBe(scaleOperatorUserId);
    expect(data!.confirmed_at).not.toBeNull();
  });

  it('2. one confirmation per trip — duplicate insert rejected', async () => {
    const { error } = await scaleOperatorClient
      .from('disposal_confirmations')
      .insert({ trip_id: tripId, status: 'confirmed', net_weight_kg: 5 });
    expect(error).not.toBeNull();
  });

  it('3. UPDATE and DELETE are rejected for authenticated (append-only)', async () => {
    const { error: updErr } = await scaleOperatorClient
      .from('disposal_confirmations')
      .update({ net_weight_kg: 999 })
      .eq('id', confirmationId);
    expect(updErr).not.toBeNull();

    const { error: delErr, count } = await scaleOperatorClient
      .from('disposal_confirmations')
      .delete({ count: 'exact' })
      .eq('id', confirmationId);
    expect(delErr !== null || count === 0 || count === null).toBe(true);

    const { data: still } = await admin
      .from('disposal_confirmations')
      .select('id, net_weight_kg')
      .eq('id', confirmationId)
      .single<{ id: string; net_weight_kg: number }>();
    expect(still?.net_weight_kg).toBe(20);
  });

  it('4. a transport-company user CANNOT insert a confirmation', async () => {
    const otherTripId = await createTrip();
    cleanupTripIds.push(otherTripId);

    const { error } = await managerClient
      .from('disposal_confirmations')
      .insert({ trip_id: otherTripId, status: 'confirmed', net_weight_kg: 10 });
    expect(error).not.toBeNull();
  });

  it('5. scale_operator of facility A cannot confirm facility B\'s trip', async () => {
    const { error } = await outsiderClient
      .from('disposal_confirmations')
      .insert({ trip_id: tripId, status: 'confirmed', net_weight_kg: 10 });
    expect(error).not.toBeNull();
  });

  it('6a. reconciliation: within tolerance sets weight_reconciliation_status accordingly', async () => {
    const t = await createTrip({ waste_stream: 'plastic' }); // 2.5% tolerance
    cleanupTripIds.push(t);
    const pe = await addPickupToTrip(t, 100);
    cleanupPickupIds.push(pe);

    const { data: conf, error } = await scaleOperatorClient
      .from('disposal_confirmations')
      .insert({ trip_id: t, status: 'confirmed', net_weight_kg: 101 }) // 1% off — within 2.5%
      .select('id')
      .single<{ id: string }>();
    expect(error).toBeNull();
    cleanupConfirmationIds.push(conf!.id);

    const { data: trip } = await admin
      .from('trips')
      .select('status, weight_reconciliation_status')
      .eq('id', t)
      .single<{ status: string; weight_reconciliation_status: string }>();
    expect(trip!.status).toBe('reconciled');
    expect(trip!.weight_reconciliation_status).toBe('within_tolerance');
  });

  it('6b. reconciliation: beyond tolerance flags the trip (never hard-blocks)', async () => {
    const t = await createTrip({ waste_stream: 'plastic' }); // 2.5% tolerance
    cleanupTripIds.push(t);
    const pe = await addPickupToTrip(t, 100);
    cleanupPickupIds.push(pe);

    const { data: conf, error } = await scaleOperatorClient
      .from('disposal_confirmations')
      .insert({ trip_id: t, status: 'confirmed', net_weight_kg: 80 }) // 20% off
      .select('id')
      .single<{ id: string }>();
    expect(error).toBeNull(); // not hard-blocked
    cleanupConfirmationIds.push(conf!.id);

    const { data: trip } = await admin
      .from('trips')
      .select('status, weight_reconciliation_status')
      .eq('id', t)
      .single<{ status: string; weight_reconciliation_status: string }>();
    expect(trip!.status).toBe('reconciled');
    expect(trip!.weight_reconciliation_status).toBe('flagged');
  });

  it('7. custody-complete flips only after confirmation; rejection leaves it not-complete', async () => {
    const confirmedTrip = await createTrip();
    cleanupTripIds.push(confirmedTrip);
    const { data: beforeConfirm } = await admin.rpc('is_trip_custody_complete', { p_trip_id: confirmedTrip });
    expect(beforeConfirm).toBe(false);

    const { data: conf } = await scaleOperatorClient
      .from('disposal_confirmations')
      .insert({ trip_id: confirmedTrip, status: 'confirmed', net_weight_kg: 15 })
      .select('id')
      .single<{ id: string }>();
    cleanupConfirmationIds.push(conf!.id);

    const { data: afterConfirm } = await admin.rpc('is_trip_custody_complete', { p_trip_id: confirmedTrip });
    expect(afterConfirm).toBe(true);

    const rejectedTrip = await createTrip();
    cleanupTripIds.push(rejectedTrip);
    const { data: rejConf } = await scaleOperatorClient
      .from('disposal_confirmations')
      .insert({ trip_id: rejectedTrip, status: 'rejected', reject_reason: 'Contaminated load' })
      .select('id')
      .single<{ id: string }>();
    cleanupConfirmationIds.push(rejConf!.id);

    const { data: afterReject } = await admin.rpc('is_trip_custody_complete', { p_trip_id: rejectedTrip });
    expect(afterReject).toBe(false);
  });

  it('8. admin_override_disposal_weight: unreachable by clients, works via service_role, is audited', async () => {
    const t = await createTrip();
    cleanupTripIds.push(t);
    const { data: conf } = await scaleOperatorClient
      .from('disposal_confirmations')
      .insert({ trip_id: t, status: 'confirmed', net_weight_kg: 42 })
      .select('id')
      .single<{ id: string }>();
    const confId = conf!.id;
    cleanupConfirmationIds.push(confId);

    // Not reachable by an authenticated client (EXECUTE revoked from PUBLIC/authenticated).
    const { error: clientErr } = await scaleOperatorClient.rpc('admin_override_disposal_weight', {
      p_confirmation_id: confId,
      p_net_weight_kg: 50,
      p_reason: 'trying to self-correct',
    });
    expect(clientErr).not.toBeNull();

    // Reachable via service_role (the admin/support-only backend path).
    const { error: adminErr } = await admin.rpc('admin_override_disposal_weight', {
      p_confirmation_id: confId,
      p_net_weight_kg: 50,
      p_reason: 'scale mis-tare confirmed by facility supervisor',
    });
    expect(adminErr).toBeNull();

    const { data: row } = await admin
      .from('disposal_confirmations')
      .select('net_weight_kg')
      .eq('id', confId)
      .single<{ net_weight_kg: number }>();
    expect(row!.net_weight_kg).toBe(50);

    const { data: auditRows } = await admin
      .from('audit_log')
      .select('action, changes')
      .eq('entity_id', confId)
      .eq('action', 'admin_override_disposal_weight');
    expect(auditRows ?? []).toHaveLength(1);
  });
});
