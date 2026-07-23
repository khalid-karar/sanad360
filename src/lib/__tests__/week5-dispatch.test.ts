/**
 * Week 5: Server-generated notifications, transport-side dispatch, driver invites
 *
 * Covers migration 011 + the /transport/invite-driver endpoint:
 *   1. Creating an assignment writes a notification for the assigned driver
 *      (SECURITY DEFINER trigger — clients cannot notify other users directly)
 *   2. A transport dispatcher can schedule assignments for a LINKED company
 *      (the seed treats dispatcher as transport-side; 003 policies didn't)
 *   3. An UNLINKED transport company's owner cannot schedule for that company
 *   4. Driver cancelling notifies the scheduler
 *   5. Invite endpoint: transport dispatcher creates a login for a fleet
 *      driver; the new account can sign in with a driver membership and the
 *      drivers row is linked. Company-side callers get 403.
 *
 * All assertions run as real signed-in users; service_role for setup/teardown.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { grandfatherCompliance } from './testHelpers/complianceExempt';

const SUPABASE_URL    = process.env.VITE_SUPABASE_URL ?? 'http://localhost:54321';
const ANON_KEY        = process.env.VITE_SUPABASE_ANON_KEY ?? '';
const SERVICE_KEY     = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const PDF_SERVICE_URL = process.env.VITE_PDF_SERVICE_URL ?? 'http://localhost:3001';

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
  driverProfileId:    'f0000000-0000-0000-0000-000000000002',
  dispatcherProfileId:'f0000000-0000-0000-0000-000000000003',
  managerEmail:       'manager@sanad360.dev',
  driverEmail:        '0501234567@driver.sanad360.com',
  dispatcherEmail:    'dispatcher@sanad360.dev',
  password:           'DevPass1234!',
};

const RUN = Date.now();
const INVITE_PHONE = `05${String(RUN).slice(-8)}`;

async function sessionClient(email: string, password = SEED.password): Promise<SupabaseClient> {
  const { data, error } = await anon.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${data.session!.access_token}` } },
  });
}

async function jwtFor(email: string, password = SEED.password): Promise<string> {
  const { data, error } = await anon.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data.session!.access_token;
}

async function isPdfServiceUp(): Promise<boolean> {
  try {
    const res = await fetch(`${PDF_SERVICE_URL}/health`, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}

describe('Week 5: notifications, transport dispatch, driver invites', () => {
  let managerClient: SupabaseClient;
  let dispatcherClient: SupabaseClient;
  let driverClient: SupabaseClient;
  let serviceUp = false;

  const createdAssignments: string[] = [];
  // Dedicated company + ACTIVE link for the dispatcher tests: the shared seed
  // link (company A ↔ TC1) is toggled inactive/active by
  // company-transporters.test.ts running in parallel, so depending on it makes
  // the 011 link-gated policies flaky.
  let dispatchCompanyId = '';
  let dispatchBranchId = '';
  let dispatchLinkId = '';
  let unlinkedTcId = '';
  let unlinkedOwnerId = '';
  let unlinkedDriverId = '';
  let unlinkedOwnerClient: SupabaseClient;
  let inviteDriverRecordId = '';
  let invitedUserId = '';

  beforeAll(async () => {
    serviceUp = await isPdfServiceUp();
    [managerClient, dispatcherClient, driverClient] = await Promise.all([
      sessionClient(SEED.managerEmail),
      sessionClient(SEED.dispatcherEmail),
      sessionClient(SEED.driverEmail),
    ]);

    // Dedicated company + branch, actively linked to the seed transport company.
    const { data: cw } = await admin
      .from('companies')
      .insert({ name_ar: `شركة الإسناد ${RUN}`, commercial_registration: `CR-W5-${RUN}` })
      .select('id')
      .single<{ id: string }>();
    dispatchCompanyId = cw!.id;
    grandfatherCompliance('company', dispatchCompanyId);
    const { data: bw } = await admin
      .from('branches')
      .insert({ company_id: dispatchCompanyId, name_ar: `فرع الإسناد ${RUN}` })
      .select('id')
      .single<{ id: string }>();
    dispatchBranchId = bw!.id;
    const { data: lw } = await admin
      .from('company_transporters')
      .insert({
        company_id: dispatchCompanyId,
        transport_company_id: SEED.transportCompanyId,
        status: 'active',
      })
      .select('id')
      .single<{ id: string }>();
    dispatchLinkId = lw!.id;

    // Unlinked transport company + owner + driver (for the negative dispatch test).
    const { data: tc } = await admin
      .from('transport_companies')
      .insert({ name_ar: `ناقل غير مرتبط ${RUN}`, commercial_registration: `CR-UNLK-${RUN}` })
      .select('id')
      .single<{ id: string }>();
    unlinkedTcId = tc!.id;

    const { data: owner } = await admin.auth.admin.createUser({
      email: `unlinked-owner-${RUN}@sanad360.dev`,
      password: SEED.password,
      email_confirm: true,
    });
    unlinkedOwnerId = owner.user!.id;
    await admin.from('memberships').insert({
      user_id: unlinkedOwnerId,
      role: 'owner',
      transport_company_id: unlinkedTcId,
    });
    const { data: d2 } = await admin
      .from('drivers')
      .insert({
        transport_company_id: unlinkedTcId,
        name_ar: 'سائق غير مرتبط',
        license_number: `UNLK-${RUN}`,
        license_expiry: '2030-01-01',
      })
      .select('id')
      .single<{ id: string }>();
    unlinkedDriverId = d2!.id;
    unlinkedOwnerClient = await sessionClient(`unlinked-owner-${RUN}@sanad360.dev`);

    // Fresh fleet driver record (no account) for the invite test.
    const { data: d3 } = await admin
      .from('drivers')
      .insert({
        transport_company_id: SEED.transportCompanyId,
        name_ar: 'سائق مدعو',
        license_number: `INV-${RUN}`,
        license_expiry: '2030-01-01',
      })
      .select('id')
      .single<{ id: string }>();
    inviteDriverRecordId = d3!.id;
  });

  afterAll(async () => {
    for (const id of createdAssignments) {
      await admin.from('pickup_assignments').delete().eq('id', id);
    }
    // Trigger-generated notifications for seed users during this run.
    await admin.from('notifications').delete()
      .in('profile_id', [SEED.driverProfileId, SEED.dispatcherProfileId]);
    if (invitedUserId) {
      await admin.from('drivers').update({ profile_id: null }).eq('id', inviteDriverRecordId);
      await admin.from('memberships').delete().eq('user_id', invitedUserId);
      await admin.from('notifications').delete().eq('profile_id', invitedUserId);
      await admin.from('profiles').delete().eq('id', invitedUserId);
      await admin.auth.admin.deleteUser(invitedUserId);
    }
    if (inviteDriverRecordId) await admin.from('drivers').delete().eq('id', inviteDriverRecordId);
    if (unlinkedDriverId) await admin.from('drivers').delete().eq('id', unlinkedDriverId);
    if (unlinkedOwnerId) {
      await admin.from('memberships').delete().eq('user_id', unlinkedOwnerId);
      await admin.from('profiles').delete().eq('id', unlinkedOwnerId);
      await admin.auth.admin.deleteUser(unlinkedOwnerId);
    }
    if (unlinkedTcId) await admin.from('transport_companies').delete().eq('id', unlinkedTcId);
    if (dispatchLinkId) await admin.from('company_transporters').delete().eq('id', dispatchLinkId);
    if (dispatchBranchId) await admin.from('branches').delete().eq('id', dispatchBranchId);
    if (dispatchCompanyId) await admin.from('companies').delete().eq('id', dispatchCompanyId);
  });

  it('1. creating an assignment notifies the assigned driver (server trigger)', async () => {
    const { data: a, error } = await managerClient
      .from('pickup_assignments')
      .insert({
        company_id: SEED.companyId,
        branch_id: SEED.branchId,
        driver_id: SEED.driverId,
        vehicle_id: SEED.vehicleId,
        scheduled_at: new Date().toISOString(),
        notes: `week5-notify ${RUN}`,
      })
      .select('id')
      .single<{ id: string }>();
    expect(error).toBeNull();
    createdAssignments.push(a!.id);

    // The driver sees a server-written notification (RLS: own rows only).
    const { data: notes } = await driverClient
      .from('notifications')
      .select('title_en, link, is_read')
      .order('created_at', { ascending: false })
      .limit(1);
    expect(notes).not.toBeNull();
    expect(notes![0]?.title_en).toBe('New Pickup Assignment');
    expect(notes![0]?.link).toBe('/driver/schedule');
    expect(notes![0]?.is_read).toBe(false);
  });

  it('2. transport dispatcher can schedule for a LINKED company (011 policy)', async () => {
    const { data: a, error } = await dispatcherClient
      .from('pickup_assignments')
      .insert({
        company_id: dispatchCompanyId,
        branch_id: dispatchBranchId,
        driver_id: SEED.driverId,
        vehicle_id: SEED.vehicleId,
        scheduled_at: new Date().toISOString(),
        notes: `week5-dispatch ${RUN}`,
      })
      .select('id')
      .single<{ id: string }>();
    expect(error).toBeNull();
    expect(a?.id).toBeTruthy();
    createdAssignments.push(a!.id);
  });

  it('3. UNLINKED transport owner cannot schedule for that company', async () => {
    const { data, error } = await unlinkedOwnerClient
      .from('pickup_assignments')
      .insert({
        company_id: SEED.companyId,
        branch_id: SEED.branchId,
        driver_id: unlinkedDriverId,
        vehicle_id: SEED.vehicleId,
        scheduled_at: new Date().toISOString(),
      })
      .select('id');
    expect(error).not.toBeNull();
    expect(data).toBeNull();
  });

  it('4. driver cancelling notifies the scheduler', async () => {
    // Dispatcher schedules (created_by = dispatcher via client insert w/ default)...
    const { data: a, error: insErr } = await dispatcherClient
      .from('pickup_assignments')
      .insert({
        company_id: dispatchCompanyId,
        branch_id: dispatchBranchId,
        driver_id: SEED.driverId,
        vehicle_id: SEED.vehicleId,
        scheduled_at: new Date().toISOString(),
        created_by: SEED.dispatcherProfileId,
        notes: `week5-cancel ${RUN}`,
      })
      .select('id')
      .single<{ id: string }>();
    expect(insErr).toBeNull();
    createdAssignments.push(a!.id);

    // ...driver cancels...
    const { error: updErr } = await driverClient
      .from('pickup_assignments')
      .update({ status: 'cancelled' })
      .eq('id', a!.id);
    expect(updErr).toBeNull();

    // ...dispatcher got the closure notification.
    const { data: notes } = await dispatcherClient
      .from('notifications')
      .select('title_en')
      .order('created_at', { ascending: false })
      .limit(1);
    expect(notes![0]?.title_en).toBe('Pickup Cancelled');
  });

  it('5a. dispatcher invites a fleet driver → account works end-to-end', async () => {
    if (!serviceUp) {
      console.warn('[week5] PDF service down — skipping invite tests.');
      return;
    }
    const jwt = await jwtFor(SEED.dispatcherEmail);
    const res = await fetch(`${PDF_SERVICE_URL}/transport/invite-driver`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
      body: JSON.stringify({
        driver_id: inviteDriverRecordId,
        phone: INVITE_PHONE,
        temp_password: 'TempDriver1234!',
      }),
    });
    expect(res.status).toBe(201);
    const json = (await res.json()) as { user_id: string; email: string };
    invitedUserId = json.user_id;
    expect(json.email).toBe(`${INVITE_PHONE}@driver.sanad360.com`);

    // The invited driver can sign in and carries a driver membership.
    const invitedClient = await sessionClient(json.email, 'TempDriver1234!');
    const { data: mem } = await invitedClient
      .from('memberships')
      .select('role, transport_company_id')
      .eq('user_id', json.user_id)
      .single<{ role: string; transport_company_id: string }>();
    expect(mem?.role).toBe('driver');
    expect(mem?.transport_company_id).toBe(SEED.transportCompanyId);

    // Fleet record is linked.
    const { data: rec } = await admin
      .from('drivers')
      .select('profile_id')
      .eq('id', inviteDriverRecordId)
      .single<{ profile_id: string }>();
    expect(rec?.profile_id).toBe(json.user_id);
  });

  it('5b. company-side caller gets 403 from the invite endpoint', async () => {
    if (!serviceUp) return;
    const jwt = await jwtFor(SEED.managerEmail);
    const res = await fetch(`${PDF_SERVICE_URL}/transport/invite-driver`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
      body: JSON.stringify({
        driver_id: inviteDriverRecordId,
        phone: '0500000001',
        temp_password: 'TempDriver1234!',
      }),
    });
    expect(res.status).toBe(403);
  });
});
