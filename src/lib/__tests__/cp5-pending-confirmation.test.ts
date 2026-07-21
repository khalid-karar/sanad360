/**
 * pending_confirmation compliance state (Migration 030)
 *
 * A pickup must never be labeled 'compliant' before a required branch
 * confirmation lands — this proves the fork happens once, server-side, at
 * insert time, and that every later transition goes through the single
 * authority function (recompute_pickup_compliance), never at read time.
 *
 * Setup uses service_role only for fixtures (the tenant's evidence_requirements
 * override, the branch_operator membership, the pickup_event rows themselves).
 * The confirmation inserts run as a real signed-in branch_operator — the
 * actual RLS-relevant action under test.
 *
 * Assertions:
 *   1. A pickup requiring branch_confirmation is NEVER 'compliant' at
 *      insert — it's 'pending_confirmation', even with otherwise-perfect
 *      evidence (score would be 0)
 *   2. Promotion: a sufficient-method confirmation (in_app_confirm) moves it
 *      to 'compliant' (score-based), missing/awaiting flags cleared
 *   3. Disputed confirmation -> non_compliant + branch_confirmation_disputed
 *   4. Insufficient-method confirmation (signature_on_driver_device, per the
 *      seeded default policy) -> non_compliant + reduced_verification,
 *      missing_required:branch_confirmation stays
 *   5. Demotion after window: no confirmation + created_at past the
 *      configured window -> non_compliant + confirmation_window_expired
 *      (via sweep_expired_pickup_confirmations(), not a real 24h wait)
 *   6. Other required items missing (e.g. photo) still dominates into
 *      non_compliant directly at insert, never pending_confirmation
 *
 * NOT covered here (explicitly deferred — app code, next phase): inspection
 * PDF / review queue rendering pending_confirmation as a distinct state.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { grandfatherCompliance } from './testHelpers/complianceExempt';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY ?? '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

if (!ANON_KEY || !SERVICE_KEY) {
  throw new Error('Set VITE_SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY in .env.');
}

const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
const anon = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });

const SEED = {
  companyId: 'a0000000-0000-0000-0000-000000000001',
  branchId: 'b0000000-0000-0000-0000-000000000001',
  transportCompanyId: 'c0000000-0000-0000-0000-000000000001',
  driverId: 'd0000000-0000-0000-0000-000000000001',
  vehicleId: 'e0000000-0000-0000-0000-000000000001',
  password: 'DevPass1234!',
};

const RUN = Date.now();

describe('pending_confirmation compliance (Migration 030)', () => {
  let evidenceReqId = '';
  let branchOpUserId = '';
  let branchOpClient: SupabaseClient;
  // A DEDICATED, throwaway transport company (+ driver + vehicle) — NOT
  // SEED.transportCompanyId. evidence_requirements is scoped per
  // transport_company_id, and SEED.transportCompanyId is the shared default
  // every other test file's fixtures also use; requiring branch_confirmation
  // on it would leak into every other suite running concurrently (this
  // exact bug shipped once already — see git history — before this fix).
  let dedicatedTcId = '';
  let dedicatedDriverId = '';
  let dedicatedVehicleId = '';

  const cleanupEventIds: string[] = [];
  const cleanupConfirmationIds: string[] = [];

  interface PickupRow {
    id: string;
    compliance_status: string;
    risk_score: number;
    risk_flags: string[];
    created_at: string;
  }

  async function insertPickupEvent(overrides: Record<string, unknown> = {}): Promise<PickupRow> {
    const { data, error } = await admin
      .from('pickup_events')
      .insert({
        logical_id: crypto.randomUUID(),
        revision: 1,
        company_id: SEED.companyId,
        branch_id: SEED.branchId,
        transport_company_id: dedicatedTcId,
        driver_id: dedicatedDriverId,
        vehicle_id: dedicatedVehicleId,
        waste_types: ['organic'],
        weight_kg: 20,
        gps_lat: 24.6877,
        gps_lng: 46.6876,
        gps_accuracy_m: 10,
        photo_path: 'p/photo.jpg',
        signature_path: 'p/sig.png',
        qr_skip_reason: 'not_applicable_for_stream',
        ...overrides,
      })
      .select('id, compliance_status, risk_score, risk_flags, created_at')
      .single<PickupRow>();
    if (error) throw new Error(`insertPickupEvent: ${error.message}`);
    cleanupEventIds.push(data.id);
    return data;
  }

  async function refetch(id: string): Promise<PickupRow> {
    const { data, error } = await admin
      .from('pickup_events')
      .select('id, compliance_status, risk_score, risk_flags, created_at')
      .eq('id', id)
      .single<PickupRow>();
    if (error) throw error;
    return data;
  }

  beforeAll(async () => {
    // Dedicated, throwaway transport company + driver + vehicle — see the
    // field comment above for why this can't be SEED.transportCompanyId.
    const { data: tc } = await admin
      .from('transport_companies')
      .insert({
        name_ar: `شركة نقل معزولة ${RUN}`,
        commercial_registration: `PEND-${RUN}`,
        ncwm_license_number: `NCWM-PEND-${RUN}`,
        ncwm_license_expiry: '2030-01-01',
      })
      .select('id')
      .single<{ id: string }>();
    dedicatedTcId = tc!.id;

    const { data: drv } = await admin
      .from('drivers')
      .insert({
        transport_company_id: dedicatedTcId,
        name_ar: 'سائق اختبار الانتظار',
        license_number: `PEND-DRV-${RUN}`,
        license_expiry: '2030-01-01',
      })
      .select('id')
      .single<{ id: string }>();
    dedicatedDriverId = drv!.id;
    // This suite predates/isn't testing CP2's document gate — grandfather
    // the fixture so it isn't blocked from completing a pickup (see
    // testHelpers/complianceExempt.ts; a plain INSERT can't set
    // compliance_exempt itself, the lock trigger pins it to false).
    grandfatherCompliance('driver', dedicatedDriverId);

    const { data: veh } = await admin
      .from('vehicles')
      .insert({
        transport_company_id: dedicatedTcId,
        plate_number: `PEND-${RUN}`,
        type: 'medium_truck',
        waste_license_type: 'general',
        ncwm_license_number: `PEND-VEH-${RUN}`,
        ncwm_license_expiry: '2030-01-01',
      })
      .select('id')
      .single<{ id: string }>();
    dedicatedVehicleId = veh!.id;
    grandfatherCompliance('vehicle', dedicatedVehicleId);

    // This dedicated transport company REQUIRES branch_confirmation (opt-in
    // — most tenants never set this).
    const { data: req } = await admin
      .from('evidence_requirements')
      .insert({
        waste_stream: '*',
        transport_company_id: dedicatedTcId,
        // Deliberately excludes 'qr' — this suite's fixtures use
        // qr_skip_reason (no qr_code_value), so requiring 'qr' too would add
        // a SECOND, unrelated missing-required item and mask the
        // branch_confirmation-specific behavior under test.
        required_items: ['geofenced_gps', 'photo', 'signature', 'branch_confirmation'],
      })
      .select('id')
      .single<{ id: string }>();
    evidenceReqId = req!.id;

    const email = `branch-op-pending-${RUN}@company.sanad360.dev`;
    const { data: created } = await admin.auth.admin.createUser({
      email,
      password: SEED.password,
      email_confirm: true,
    });
    branchOpUserId = created.user!.id;
    await admin.from('memberships').insert({
      user_id: branchOpUserId,
      role: 'branch_operator',
      company_id: SEED.companyId,
      branch_id: SEED.branchId,
    });
    const { data: signIn, error: signInErr } = await anon.auth.signInWithPassword({ email, password: SEED.password });
    if (signInErr || !signIn.session) throw new Error(`sign-in failed: ${signInErr?.message}`);
    branchOpClient = createClient(SUPABASE_URL, ANON_KEY, {
      auth: { persistSession: false },
      global: { headers: { Authorization: `Bearer ${signIn.session.access_token}` } },
    });
  });

  afterAll(async () => {
    if (cleanupConfirmationIds.length) {
      await admin.from('pickup_confirmations').delete().in('id', cleanupConfirmationIds);
    }
    if (cleanupEventIds.length) {
      await admin.from('pickup_events').delete().in('id', cleanupEventIds);
    }
    if (branchOpUserId) {
      await admin.from('memberships').delete().eq('user_id', branchOpUserId);
      await admin.from('profiles').delete().eq('id', branchOpUserId);
      await admin.auth.admin.deleteUser(branchOpUserId);
    }
    if (evidenceReqId) await admin.from('evidence_requirements').delete().eq('id', evidenceReqId);
    if (dedicatedVehicleId) await admin.from('vehicles').delete().eq('id', dedicatedVehicleId);
    if (dedicatedDriverId) await admin.from('drivers').delete().eq('id', dedicatedDriverId);
    if (dedicatedTcId) await admin.from('transport_companies').delete().eq('id', dedicatedTcId);
  });

  it("1. a pickup requiring branch_confirmation is NEVER 'compliant' at insert, even with otherwise-perfect evidence", async () => {
    const ev = await insertPickupEvent();
    expect(ev.compliance_status).toBe('pending_confirmation');
    expect(ev.risk_score).toBe(0);
    expect(ev.risk_flags).toContain('awaiting_branch_confirmation');
    expect(ev.risk_flags).toContain('missing_required_evidence');
    expect(ev.risk_flags).toContain('missing_required:branch_confirmation');
  });

  it('2. promotion: a sufficient-method confirmation (in_app_confirm) moves it to compliant', async () => {
    const ev = await insertPickupEvent();
    expect(ev.compliance_status).toBe('pending_confirmation');

    const { data: confirmation, error } = await branchOpClient
      .from('pickup_confirmations')
      .insert({ pickup_event_id: ev.id, method: 'in_app_confirm' })
      .select('id')
      .single<{ id: string }>();
    expect(error).toBeNull();
    cleanupConfirmationIds.push(confirmation!.id);

    const after = await refetch(ev.id);
    expect(after.compliance_status).toBe('compliant');
    expect(after.risk_flags).not.toContain('awaiting_branch_confirmation');
    expect(after.risk_flags).not.toContain('missing_required_evidence');
    expect(after.risk_flags).not.toContain('missing_required:branch_confirmation');
  });

  it('3. a disputed confirmation demotes to non_compliant', async () => {
    const ev = await insertPickupEvent();

    const { data: confirmation, error } = await branchOpClient
      .from('pickup_confirmations')
      .insert({
        pickup_event_id: ev.id,
        method: 'in_app_confirm',
        status: 'disputed',
        dispute_reason: 'Driver and branch disagree on the recorded weight.',
      })
      .select('id')
      .single<{ id: string }>();
    expect(error).toBeNull();
    cleanupConfirmationIds.push(confirmation!.id);

    const after = await refetch(ev.id);
    expect(after.compliance_status).toBe('non_compliant');
    expect(after.risk_flags).toContain('branch_confirmation_disputed');
  });

  it("4. an insufficient-method confirmation (signature_on_driver_device) still demotes to non_compliant with reduced_verification", async () => {
    const ev = await insertPickupEvent();

    const { data: confirmation, error } = await branchOpClient
      .from('pickup_confirmations')
      .insert({ pickup_event_id: ev.id, method: 'signature_on_driver_device' })
      .select('id')
      .single<{ id: string }>();
    expect(error).toBeNull();
    cleanupConfirmationIds.push(confirmation!.id);

    const after = await refetch(ev.id);
    expect(after.compliance_status).toBe('non_compliant');
    expect(after.risk_flags).toContain('reduced_verification');
    expect(after.risk_flags).toContain('missing_required:branch_confirmation');
  });

  it('5. demotion after the configured window elapses (no confirmation at all)', async () => {
    const ev = await insertPickupEvent();
    expect(ev.compliance_status).toBe('pending_confirmation');

    // Backdate past the seeded 24h global default window — service_role
    // bypasses grants/RLS entirely, so this direct UPDATE is a fixture
    // manipulation, not something any authenticated client could do.
    await admin
      .from('pickup_events')
      .update({ created_at: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString() })
      .eq('id', ev.id);

    const { error: sweepErr } = await admin.rpc('sweep_expired_pickup_confirmations');
    expect(sweepErr).toBeNull();

    const after = await refetch(ev.id);
    expect(after.compliance_status).toBe('non_compliant');
    expect(after.risk_flags).toContain('confirmation_window_expired');
    expect(after.risk_flags).not.toContain('awaiting_branch_confirmation');
  });

  it('6. other required items missing still dominates into non_compliant directly at insert (never pending_confirmation)', async () => {
    const ev = await insertPickupEvent({ photo_path: null });
    expect(ev.compliance_status).toBe('non_compliant');
    expect(ev.risk_flags).toContain('missing_required:photo');
    expect(ev.risk_flags).toContain('missing_required:branch_confirmation');
    expect(ev.risk_flags).not.toContain('awaiting_branch_confirmation');
  });
});
