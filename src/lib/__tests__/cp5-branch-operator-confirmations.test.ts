/**
 * Branch operator confirm/dispute flow (CP5 app-code phase 4d, migrations
 * 026/030) — src/lib/api/pickupConfirmations.ts
 *
 * Assertions:
 *   1. A branch_operator sees their own branch's pending_confirmation
 *      pickups (and none from another branch)
 *   2. Confirming (in_app_confirm) resolves pending_confirmation → the
 *      pickup's ordinary score-based status (recompute_pickup_compliance,
 *      migration 030, fires via the AFTER INSERT trigger — no client call)
 *   3. Disputing resolves pending_confirmation → non_compliant with
 *      branch_confirmation_disputed
 *   4. A branch_operator CANNOT confirm a pickup at a DIFFERENT branch
 *      (RLS insert policy: branch_id must equal their own membership)
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

describe('Branch operator confirm/dispute (Migrations 026/030, CP5 4d)', () => {
  let companyId = '';
  let branchAId = '';
  let branchBId = '';
  let tcId = '';
  let driverId = '';
  let vehicleId = '';
  let operatorAUserId = '';
  let operatorBUserId = '';
  let operatorAClient: SupabaseClient;
  let operatorBClient: SupabaseClient;
  const cleanupEventIds: string[] = [];

  beforeAll(async () => {
    const { data: company } = await admin
      .from('companies')
      .insert({ name_ar: `شركة عامل الفرع ${RUN}`, commercial_registration: `BOPC-${RUN}` })
      .select('id').single<{ id: string }>();
    companyId = company!.id;

    // geofence set to exactly match the pickup gps below — otherwise
    // geofence_verified=false adds its OWN missing-required-item
    // ('geofenced_gps' is in required_items here), which would make
    // pickup_events_before_insert land on non_compliant (multiple items
    // missing) instead of pending_confirmation (ONLY branch_confirmation
    // missing) — the exact distinction this test suite is exercising.
    const { data: branchA } = await admin
      .from('branches').insert({
        company_id: companyId, name_ar: `فرع أ ${RUN}`,
        geofence_lat: 24.6877, geofence_lng: 46.6876, geofence_radius_m: 150,
      })
      .select('id').single<{ id: string }>();
    branchAId = branchA!.id;

    const { data: branchB } = await admin
      .from('branches').insert({
        company_id: companyId, name_ar: `فرع ب ${RUN}`,
        geofence_lat: 24.6877, geofence_lng: 46.6876, geofence_radius_m: 150,
      })
      .select('id').single<{ id: string }>();
    branchBId = branchB!.id;

    const { data: tc } = await admin
      .from('transport_companies')
      .insert({
        name_ar: `شركة نقل عامل الفرع ${RUN}`,
        commercial_registration: `BOPC-TC-${RUN}`,
        ncwm_license_number: `NCWM-BOPC-${RUN}`,
        ncwm_license_expiry: '2030-01-01',
      })
      .select('id').single<{ id: string }>();
    tcId = tc!.id;

    const { data: drv } = await admin
      .from('drivers')
      .insert({ transport_company_id: tcId, name_ar: 'سائق عامل الفرع', license_number: `BOPC-DRV-${RUN}`, license_expiry: '2030-01-01' })
      .select('id').single<{ id: string }>();
    driverId = drv!.id;
    grandfatherCompliance('driver', driverId);

    const { data: veh } = await admin
      .from('vehicles')
      .insert({ transport_company_id: tcId, plate_number: `BOPC-${RUN}`, type: 'medium_truck', waste_license_type: 'general', ncwm_license_number: `BOPC-VEH-${RUN}`, ncwm_license_expiry: '2030-01-01' })
      .select('id').single<{ id: string }>();
    vehicleId = veh!.id;
    grandfatherCompliance('vehicle', vehicleId);

    // evidence_requirements: branch_confirmation required for this transporter.
    await admin.from('evidence_requirements').insert({
      waste_stream: '*',
      transport_company_id: tcId,
      required_items: ['geofenced_gps', 'photo', 'signature', 'branch_confirmation'],
    });

    const { data: opA } = await admin.auth.admin.createUser({
      email: `branch-op-a-${RUN}@company.sanad360.dev`, password: PASSWORD, email_confirm: true,
    });
    operatorAUserId = opA.user!.id;
    await admin.from('memberships').insert({ user_id: operatorAUserId, role: 'branch_operator', company_id: companyId, branch_id: branchAId });
    operatorAClient = await sessionClient(`branch-op-a-${RUN}@company.sanad360.dev`);

    const { data: opB } = await admin.auth.admin.createUser({
      email: `branch-op-b-${RUN}@company.sanad360.dev`, password: PASSWORD, email_confirm: true,
    });
    operatorBUserId = opB.user!.id;
    await admin.from('memberships').insert({ user_id: operatorBUserId, role: 'branch_operator', company_id: companyId, branch_id: branchBId });
    operatorBClient = await sessionClient(`branch-op-b-${RUN}@company.sanad360.dev`);
  });

  afterAll(async () => {
    if (cleanupEventIds.length) {
      await admin.from('pickup_confirmations').delete().in('pickup_event_id', cleanupEventIds);
      await admin.from('pickup_events').delete().in('id', cleanupEventIds);
    }
    await admin.from('evidence_requirements').delete().eq('transport_company_id', tcId);
    for (const uid of [operatorAUserId, operatorBUserId]) {
      if (!uid) continue;
      await admin.from('memberships').delete().eq('user_id', uid);
      await admin.from('profiles').delete().eq('id', uid);
      await admin.auth.admin.deleteUser(uid).catch(() => {});
    }
    if (vehicleId) await admin.from('vehicles').delete().eq('id', vehicleId);
    if (driverId) await admin.from('drivers').delete().eq('id', driverId);
    if (tcId) await admin.from('transport_companies').delete().eq('id', tcId);
    if (branchAId) await admin.from('branches').delete().eq('id', branchAId);
    if (branchBId) await admin.from('branches').delete().eq('id', branchBId);
    if (companyId) await admin.from('companies').delete().eq('id', companyId);
  });

  async function makePendingPickup(branchId: string): Promise<string> {
    const { data, error } = await admin
      .from('pickup_events')
      .insert({
        logical_id: crypto.randomUUID(),
        revision: 1,
        company_id: companyId,
        branch_id: branchId,
        transport_company_id: tcId,
        driver_id: driverId,
        vehicle_id: vehicleId,
        waste_types: ['organic'],
        weight_kg: 12,
        gps_lat: 24.6877,
        gps_lng: 46.6876,
        gps_accuracy_m: 10,
        photo_path: 'p.jpg',
        signature_path: 's.png',
        qr_skip_reason: 'not_applicable_for_stream',
      })
      .select('id, compliance_status')
      .single<{ id: string; compliance_status: string }>();
    expect(error).toBeNull();
    expect(data!.compliance_status).toBe('pending_confirmation');
    cleanupEventIds.push(data!.id);
    return data!.id;
  }

  it('1. branch_operator sees only their own branch\'s pending confirmations', async () => {
    const eventA = await makePendingPickup(branchAId);
    const eventB = await makePendingPickup(branchBId);

    const { data: aView, error: aErr } = await operatorAClient
      .from('pickup_events')
      .select('id')
      .eq('branch_id', branchAId)
      .eq('compliance_status', 'pending_confirmation');
    expect(aErr).toBeNull();
    expect((aView ?? []).map((r) => r.id)).toContain(eventA);
    expect((aView ?? []).map((r) => r.id)).not.toContain(eventB);

    // Same check from operator B's own session, for their own branch.
    const { data: bView, error: bErr } = await operatorBClient
      .from('pickup_events')
      .select('id')
      .eq('branch_id', branchBId)
      .eq('compliance_status', 'pending_confirmation');
    expect(bErr).toBeNull();
    expect((bView ?? []).map((r) => r.id)).toContain(eventB);
    expect((bView ?? []).map((r) => r.id)).not.toContain(eventA);
  });

  it('2. confirming (in_app_confirm) resolves pending_confirmation to a score-based status', async () => {
    const eventId = await makePendingPickup(branchAId);

    const { error: confirmErr } = await operatorAClient
      .from('pickup_confirmations')
      .insert({ pickup_event_id: eventId, method: 'in_app_confirm', status: 'confirmed' });
    expect(confirmErr).toBeNull();

    const { data: after } = await admin
      .from('pickup_events')
      .select('compliance_status, risk_flags')
      .eq('id', eventId)
      .single<{ compliance_status: string; risk_flags: string[] }>();
    expect(after!.compliance_status).not.toBe('pending_confirmation');
    expect(after!.risk_flags).not.toContain('awaiting_branch_confirmation');
    expect(after!.risk_flags).not.toContain('missing_required:branch_confirmation');
  });

  it('3. disputing resolves pending_confirmation to non_compliant with branch_confirmation_disputed', async () => {
    const eventId = await makePendingPickup(branchAId);

    const { error: disputeErr } = await operatorAClient
      .from('pickup_confirmations')
      .insert({ pickup_event_id: eventId, method: 'in_app_confirm', status: 'disputed', dispute_reason: 'لم يتم الاستلام كما هو مسجل' });
    expect(disputeErr).toBeNull();

    const { data: after } = await admin
      .from('pickup_events')
      .select('compliance_status, risk_flags')
      .eq('id', eventId)
      .single<{ compliance_status: string; risk_flags: string[] }>();
    expect(after!.compliance_status).toBe('non_compliant');
    expect(after!.risk_flags).toContain('branch_confirmation_disputed');
  });

  it('4. a branch_operator cannot confirm a pickup at a DIFFERENT branch', async () => {
    const eventAtBranchB = await makePendingPickup(branchBId);

    const { error } = await operatorAClient
      .from('pickup_confirmations')
      .insert({ pickup_event_id: eventAtBranchB, method: 'in_app_confirm', status: 'confirmed' });
    expect(error).not.toBeNull();
  });
});
