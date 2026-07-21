/**
 * Evidence Hardening (Migration 013)
 *
 * QR verification, GPS-accuracy-aware geofencing, weight plausibility, and
 * assignment least-privilege. Access-control assertions run as real signed-in
 * users; risk-engine assertions use service_role inserts (the trigger runs
 * identically for both).
 *
 * Assertions:
 *   1. Scanning the branch's real qr_token → qr_verified = true, no flag
 *   2. Wrong QR value → qr_verified = false + qr_mismatch flag
 *   3. In-fence GPS with accuracy WORSE than the radius → geofence_failed
 *      + gps_low_accuracy (position is not credible)
 *   4. Implausible weight (> 5000 kg) → weight_anomaly flag
 *   5. Driver A CANNOT see or update driver B's assignment (least-privilege);
 *      B still can
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { grandfatherCompliance } from './testHelpers/complianceExempt';

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
  companyId:          'a0000000-0000-0000-0000-000000000001',
  branchId:           'b0000000-0000-0000-0000-000000000001',
  transportCompanyId: 'c0000000-0000-0000-0000-000000000001',
  driverId:           'd0000000-0000-0000-0000-000000000001',
  vehicleId:          'e0000000-0000-0000-0000-000000000001',
  driverEmail:        '0501234567@driver.sanad360.com',
  password:           'DevPass1234!',
};

const RUN = Date.now();

async function sessionClient(email: string, password = SEED.password): Promise<SupabaseClient> {
  const { data, error } = await anon.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${data.session!.access_token}` } },
  });
}

interface EventResult {
  id: string;
  qr_verified: boolean;
  geofence_verified: boolean;
  risk_flags: string[];
}

const cleanupEventIds: string[] = [];

async function insertEvent(overrides: Record<string, unknown>): Promise<EventResult> {
  const { data, error } = await admin
    .from('pickup_events')
    .insert({
      logical_id: crypto.randomUUID(),
      revision: 1,
      company_id: SEED.companyId,
      branch_id: SEED.branchId,
      transport_company_id: SEED.transportCompanyId,
      driver_id: SEED.driverId,
      vehicle_id: SEED.vehicleId,
      waste_types: ['organic'],
      weight_kg: 20,
      gps_lat: 24.6877,
      gps_lng: 46.6876,
      gps_accuracy_m: 10,
      photo_path: 'p/photo.jpg',
      signature_path: 'p/sig.png',
      ...overrides,
    })
    .select('id, qr_verified, geofence_verified, risk_flags')
    .single<EventResult>();
  if (error) throw new Error(`insertEvent: ${error.message}`);
  cleanupEventIds.push(data.id);
  return data;
}

describe('Evidence hardening (Migration 013)', () => {
  let branchQrToken = '';
  let driverBUserId = '';
  let driverBRecordId = '';
  let driverBClient: SupabaseClient;
  let driverAClient: SupabaseClient;
  let assignmentBId = '';

  beforeAll(async () => {
    const { data: branch } = await admin
      .from('branches')
      .select('qr_token')
      .eq('id', SEED.branchId)
      .single<{ qr_token: string }>();
    branchQrToken = branch!.qr_token;

    // Second driver (B) in the same transport company, with a linked account.
    const { data: created } = await admin.auth.admin.createUser({
      email: `driver-b-${RUN}@driver.sanad360.com`,
      password: SEED.password,
      email_confirm: true,
    });
    driverBUserId = created.user!.id;
    await admin.from('memberships').insert({
      user_id: driverBUserId,
      role: 'driver',
      transport_company_id: SEED.transportCompanyId,
    });
    const { data: dB } = await admin
      .from('drivers')
      .insert({
        transport_company_id: SEED.transportCompanyId,
        profile_id: driverBUserId,
        name_ar: 'سائق ب',
        license_number: `HARD-${RUN}`,
        license_expiry: '2030-01-01',
      })
      .select('id')
      .single<{ id: string }>();
    driverBRecordId = dB!.id;
    // This suite predates CP2's document gate and isn't testing it —
    // grandfather the fixture so it doesn't get blocked from being
    // scheduled (see testHelpers/complianceExempt.ts).
    grandfatherCompliance('driver', driverBRecordId);

    // An assignment for driver B.
    const { data: a } = await admin
      .from('pickup_assignments')
      .insert({
        company_id: SEED.companyId,
        branch_id: SEED.branchId,
        driver_id: driverBRecordId,
        vehicle_id: SEED.vehicleId,
        scheduled_at: new Date().toISOString(),
      })
      .select('id')
      .single<{ id: string }>();
    assignmentBId = a!.id;

    [driverAClient, driverBClient] = await Promise.all([
      sessionClient(SEED.driverEmail),
      sessionClient(`driver-b-${RUN}@driver.sanad360.com`),
    ]);
  });

  afterAll(async () => {
    if (assignmentBId) await admin.from('pickup_assignments').delete().eq('id', assignmentBId);
    if (cleanupEventIds.length) await admin.from('pickup_events').delete().in('id', cleanupEventIds);
    if (driverBRecordId) await admin.from('drivers').delete().eq('id', driverBRecordId);
    if (driverBUserId) {
      await admin.from('memberships').delete().eq('user_id', driverBUserId);
      await admin.from('notifications').delete().eq('profile_id', driverBUserId);
      await admin.from('profiles').delete().eq('id', driverBUserId);
      await admin.auth.admin.deleteUser(driverBUserId);
    }
  });

  it('1. real branch qr_token verifies server-side (no flag)', async () => {
    const ev = await insertEvent({ qr_code_value: branchQrToken });
    expect(ev.qr_verified).toBe(true);
    expect(ev.risk_flags).not.toContain('qr_mismatch');
  });

  it('2. wrong QR value → qr_verified=false + qr_mismatch flag', async () => {
    const ev = await insertEvent({ qr_code_value: `WRONG-${RUN}` });
    expect(ev.qr_verified).toBe(false);
    expect(ev.risk_flags).toContain('qr_mismatch');
  });

  it('3. in-fence GPS with poor accuracy fails the geofence', async () => {
    // Seed branch radius is 150 m; a 400 m-accuracy fix proves nothing.
    const ev = await insertEvent({ gps_accuracy_m: 400 });
    expect(ev.geofence_verified).toBe(false);
    expect(ev.risk_flags).toContain('geofence_failed');
    expect(ev.risk_flags).toContain('gps_low_accuracy');
  });

  it('4. implausible weight flags weight_anomaly', async () => {
    const ev = await insertEvent({ weight_kg: 12000 });
    expect(ev.risk_flags).toContain('weight_anomaly');
  });

  it("5. driver A cannot see or update driver B's assignment; B can", async () => {
    // A sees nothing.
    const { data: aSees } = await driverAClient
      .from('pickup_assignments')
      .select('id')
      .eq('id', assignmentBId);
    expect(aSees ?? []).toHaveLength(0);

    // A cannot update (0 rows affected / no visibility).
    await driverAClient
      .from('pickup_assignments')
      .update({ status: 'cancelled' })
      .eq('id', assignmentBId);
    const { data: after } = await admin
      .from('pickup_assignments')
      .select('status')
      .eq('id', assignmentBId)
      .single<{ status: string }>();
    expect(after?.status).toBe('pending');

    // B accepts their own job.
    const { error: bErr } = await driverBClient
      .from('pickup_assignments')
      .update({ status: 'accepted' })
      .eq('id', assignmentBId);
    expect(bErr).toBeNull();
    const { data: final } = await admin
      .from('pickup_assignments')
      .select('status')
      .eq('id', assignmentBId)
      .single<{ status: string }>();
    expect(final?.status).toBe('accepted');
  });
});
