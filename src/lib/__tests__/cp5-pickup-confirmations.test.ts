/**
 * pickup_confirmations (Migration 026)
 *
 * A branch_operator's attestation of a pickup — a separate, second-party
 * append-only table (mirrors disposal_confirmations), NOT columns on the
 * driver's own pickup_events row. RLS tests run as REAL signed-in users;
 * service_role is used only to seed fixtures (the pickup_event itself, and
 * the branch_operator memberships), never as the subject of an assertion.
 *
 * Assertions:
 *   1. A branch_operator of the pickup's own branch can insert a
 *      confirmation (method='in_app_confirm')
 *   2. branch_id/company_id are server-forced from the pickup_event — a
 *      client-supplied branch_id is ignored, not trusted
 *   3. A branch_operator of a DIFFERENT branch is rejected (RLS)
 *   4. A company manager (not branch_operator) is rejected
 *   5. A driver is rejected
 *   6. method='unavailable' with empty notes is rejected (CHECK);
 *      with real notes it succeeds
 *   7. UPDATE and DELETE are rejected for authenticated (append-only)
 *   8. A confirmed insert writes exactly one audit_log row
 *   9. The hauling transporter can SELECT the confirmation via the
 *      pickup_events join; an unrelated transporter cannot
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

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
  managerEmail: 'manager@sanad360.dev',
  driverEmail: '0501234567@driver.sanad360.com',
  password: 'DevPass1234!',
};

const RUN = Date.now();

async function sessionClient(email: string, password = SEED.password): Promise<SupabaseClient> {
  const { data, error } = await anon.auth.signInWithPassword({ email, password });
  if (error || !data.session) throw new Error(`sign-in failed (${email}): ${error?.message}`);
  return createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${data.session.access_token}` } },
  });
}

async function createUserWithMembership(
  emailPrefix: string,
  role: string,
  membership: Record<string, unknown>
): Promise<{ userId: string; client: SupabaseClient }> {
  const email = `${emailPrefix}-${RUN}@company.sanad360.dev`;
  const { data: created, error } = await admin.auth.admin.createUser({
    email,
    password: SEED.password,
    email_confirm: true,
  });
  if (error || !created.user) throw new Error(`createUser failed: ${error?.message}`);
  const { error: memErr } = await admin.from('memberships').insert({
    user_id: created.user.id,
    role,
    ...membership,
  });
  if (memErr) throw new Error(`membership insert failed: ${memErr.message}`);
  const client = await sessionClient(email);
  return { userId: created.user.id, client };
}

describe('pickup_confirmations (Migration 026)', () => {
  let otherCompanyId = '';
  let otherBranchId = '';
  let branchOpUserId = '';
  let branchOpClient: SupabaseClient;
  let otherBranchOpUserId = '';
  let otherBranchOpClient: SupabaseClient;
  let managerClient: SupabaseClient;
  let driverClient: SupabaseClient;

  const cleanupConfirmationIds: string[] = [];
  const cleanupEventIds: string[] = [];

  async function insertPickupEvent(): Promise<string> {
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
        photo_path: 'p/photo.jpg',
        signature_path: 'p/sig.png',
        qr_skip_reason: 'not_applicable_for_stream',
      })
      .select('id')
      .single<{ id: string }>();
    if (error) throw new Error(`pickup_event insert failed: ${error.message}`);
    cleanupEventIds.push(data.id);
    return data.id;
  }

  beforeAll(async () => {
    const { data: company } = await admin
      .from('companies')
      .insert({ name_ar: 'شركة أخرى (تأكيد الالتقاط)', commercial_registration: `PC-${RUN}` })
      .select('id')
      .single<{ id: string }>();
    otherCompanyId = company!.id;

    const { data: branch } = await admin
      .from('branches')
      .insert({ company_id: otherCompanyId, name_ar: 'فرع آخر' })
      .select('id')
      .single<{ id: string }>();
    otherBranchId = branch!.id;

    const opA = await createUserWithMembership('branch-op-own', 'branch_operator', {
      company_id: SEED.companyId,
      branch_id: SEED.branchId,
    });
    branchOpUserId = opA.userId;
    branchOpClient = opA.client;

    const opB = await createUserWithMembership('branch-op-other', 'branch_operator', {
      company_id: otherCompanyId,
      branch_id: otherBranchId,
    });
    otherBranchOpUserId = opB.userId;
    otherBranchOpClient = opB.client;

    managerClient = await sessionClient(SEED.managerEmail);
    driverClient = await sessionClient(SEED.driverEmail);
  });

  afterAll(async () => {
    if (cleanupConfirmationIds.length) {
      await admin.from('pickup_confirmations').delete().in('id', cleanupConfirmationIds);
    }
    if (cleanupEventIds.length) {
      await admin.from('pickup_events').delete().in('id', cleanupEventIds);
    }
    for (const uid of [branchOpUserId, otherBranchOpUserId]) {
      if (!uid) continue;
      await admin.from('memberships').delete().eq('user_id', uid);
      await admin.from('profiles').delete().eq('id', uid);
      await admin.auth.admin.deleteUser(uid);
    }
    if (otherBranchId) await admin.from('branches').delete().eq('id', otherBranchId);
    if (otherCompanyId) await admin.from('companies').delete().eq('id', otherCompanyId);
  });

  it("1. branch_operator of the pickup's own branch can confirm it", async () => {
    const eventId = await insertPickupEvent();
    const { data, error } = await branchOpClient
      .from('pickup_confirmations')
      .insert({ pickup_event_id: eventId, method: 'in_app_confirm' })
      .select('id, branch_id, company_id, confirmed_by, status')
      .single<{ id: string; branch_id: string; company_id: string; confirmed_by: string; status: string }>();

    expect(error).toBeNull();
    expect(data).not.toBeNull();
    cleanupConfirmationIds.push(data!.id);
    expect(data!.branch_id).toBe(SEED.branchId);
    expect(data!.company_id).toBe(SEED.companyId);
    expect(data!.confirmed_by).toBe(branchOpUserId);
    expect(data!.status).toBe('confirmed');
  });

  it('2. a client-supplied branch_id/company_id is ignored — server forces it from the pickup_event', async () => {
    const eventId = await insertPickupEvent();
    const { data, error } = await branchOpClient
      .from('pickup_confirmations')
      .insert({
        pickup_event_id: eventId,
        method: 'in_app_confirm',
        branch_id: otherBranchId, // spoof attempt
        company_id: otherCompanyId, // spoof attempt
      })
      .select('id, branch_id, company_id')
      .single<{ id: string; branch_id: string; company_id: string }>();

    expect(error).toBeNull();
    cleanupConfirmationIds.push(data!.id);
    // Forced back to the REAL pickup_event's branch/company, not the spoofed values.
    expect(data!.branch_id).toBe(SEED.branchId);
    expect(data!.company_id).toBe(SEED.companyId);
  });

  it("3. a branch_operator of a DIFFERENT branch cannot confirm this branch's pickup", async () => {
    const eventId = await insertPickupEvent();
    const { data, error } = await otherBranchOpClient
      .from('pickup_confirmations')
      .insert({ pickup_event_id: eventId, method: 'in_app_confirm' })
      .select('id');

    expect(error).not.toBeNull();
    expect(data).toBeNull();
  });

  it('4. a company manager (not branch_operator) cannot confirm', async () => {
    const eventId = await insertPickupEvent();
    const { data, error } = await managerClient
      .from('pickup_confirmations')
      .insert({ pickup_event_id: eventId, method: 'in_app_confirm' })
      .select('id');

    expect(error).not.toBeNull();
    expect(data).toBeNull();
  });

  it('5. a driver cannot confirm', async () => {
    const eventId = await insertPickupEvent();
    const { data, error } = await driverClient
      .from('pickup_confirmations')
      .insert({ pickup_event_id: eventId, method: 'in_app_confirm' })
      .select('id');

    expect(error).not.toBeNull();
    expect(data).toBeNull();
  });

  it("6a. method='unavailable' with empty notes is rejected", async () => {
    const eventId = await insertPickupEvent();
    const { data, error } = await branchOpClient
      .from('pickup_confirmations')
      .insert({ pickup_event_id: eventId, method: 'unavailable' })
      .select('id');

    expect(error).not.toBeNull();
    expect(error!.code).toBe('23514');
    expect(data).toBeNull();
  });

  it("6b. method='unavailable' with real notes succeeds", async () => {
    const eventId = await insertPickupEvent();
    const { data, error } = await branchOpClient
      .from('pickup_confirmations')
      .insert({
        pickup_event_id: eventId,
        method: 'unavailable',
        notes: 'Branch operator was off-site; confirmed by phone with dispatcher.',
      })
      .select('id')
      .single<{ id: string }>();

    expect(error).toBeNull();
    cleanupConfirmationIds.push(data!.id);
  });

  it('7. UPDATE and DELETE are rejected for authenticated (append-only)', async () => {
    const eventId = await insertPickupEvent();
    const { data: inserted } = await branchOpClient
      .from('pickup_confirmations')
      .insert({ pickup_event_id: eventId, method: 'in_app_confirm' })
      .select('id')
      .single<{ id: string }>();
    cleanupConfirmationIds.push(inserted!.id);

    const { error: updateErr } = await branchOpClient
      .from('pickup_confirmations')
      .update({ notes: 'tamper attempt' })
      .eq('id', inserted!.id);
    expect(updateErr).not.toBeNull();

    const { error: deleteErr } = await branchOpClient
      .from('pickup_confirmations')
      .delete()
      .eq('id', inserted!.id);
    expect(deleteErr).not.toBeNull();
  });

  it('8. a confirmed insert writes exactly one audit_log row', async () => {
    const eventId = await insertPickupEvent();
    const { data: inserted } = await branchOpClient
      .from('pickup_confirmations')
      .insert({ pickup_event_id: eventId, method: 'in_app_confirm' })
      .select('id')
      .single<{ id: string }>();
    cleanupConfirmationIds.push(inserted!.id);

    const { data: logs } = await admin
      .from('audit_log')
      .select('id, action, entity_type, entity_id, tenant_id, tenant_type')
      .eq('entity_type', 'pickup_confirmations')
      .eq('entity_id', inserted!.id);

    expect(logs).toHaveLength(1);
    expect(logs![0].action).toBe('create_pickup_confirmation');
    expect(logs![0].tenant_type).toBe('company');
    expect(logs![0].tenant_id).toBe(SEED.companyId);
  });

  it("9. the hauling transporter can read the confirmation; an unrelated transporter cannot", async () => {
    const eventId = await insertPickupEvent();
    const { data: inserted } = await branchOpClient
      .from('pickup_confirmations')
      .insert({ pickup_event_id: eventId, method: 'in_app_confirm' })
      .select('id')
      .single<{ id: string }>();
    cleanupConfirmationIds.push(inserted!.id);

    // driverClient belongs to SEED.transportCompanyId, the transporter that
    // actually hauled this pickup — visible via the pickup_events join.
    const { data: seenByHauler } = await driverClient
      .from('pickup_confirmations')
      .select('id')
      .eq('id', inserted!.id);
    expect(seenByHauler).toHaveLength(1);

    // otherBranchOpClient's company has no relationship to this pickup at all.
    const { data: seenByOther } = await otherBranchOpClient
      .from('pickup_confirmations')
      .select('id')
      .eq('id', inserted!.id);
    expect(seenByOther ?? []).toHaveLength(0);
  });
});
