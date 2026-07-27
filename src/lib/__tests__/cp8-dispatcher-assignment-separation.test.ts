/**
 * CP8 Slice: separation of duties (migration 044) — the company REQUESTS a
 * pickup with no driver/vehicle; a linked transport company's dispatcher
 * assigns its own driver + vehicle, transitioning the request from
 * 'requested' to 'pending'. All fixtures are dedicated per-run rigs (never
 * the shared seed) since this suite mutates RLS-sensitive state (real
 * sign-ins, real INSERT/UPDATE attempts) that must not interact with any
 * other file running concurrently.
 *
 * Assertions:
 *   1. Company creates a request with driver_id/vehicle_id NULL, status
 *      'requested' — the happy path this migration exists to enable.
 *   2. Company CANNOT set driver_id/vehicle_id on INSERT (raw API) — RLS
 *      WITH CHECK rejection, not a UI-only restriction.
 *   3. Company CANNOT set driver_id/vehicle_id on UPDATE (raw API) — the
 *      trigger-level guard (RLS alone can't diff OLD vs NEW columns).
 *   4. A linked transporter's dispatcher CAN assign its own driver+vehicle
 *      onto the request, transitioning it to 'pending'.
 *   5. A dispatcher CANNOT assign another transporter's fleet onto its own
 *      linked company's request (fleet-ownership check).
 *   6. A dispatcher CANNOT reach (let alone assign onto) a NON-linked
 *      company's request at all — RLS makes the row invisible, not just the
 *      write rejected.
 *   7. The gate blocks assignment at UPDATE time for a doc-expired driver,
 *      vehicle, and transport_company (three independent sub-cases).
 *   8. A doc-expired company is blocked at REQUEST time (INSERT), before any
 *      driver/vehicle is ever involved.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { describe, it, expect, afterAll } from 'vitest';
import { grandfatherCompliance } from './testHelpers/complianceExempt';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY     = process.env.VITE_SUPABASE_ANON_KEY ?? '';
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
if (!ANON_KEY || !SERVICE_KEY) {
  throw new Error('Set VITE_SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY in .env.');
}

const admin: SupabaseClient = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
const anon:  SupabaseClient = createClient(SUPABASE_URL, ANON_KEY,    { auth: { persistSession: false } });

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

interface Rig {
  companyId: string;
  branchId: string;
  transportCompanyId: string;
  driverId: string;
  vehicleId: string;
}

/** A fresh, fully independent company+branch+transport_company+driver+vehicle rig. */
async function makeRig(tag: string): Promise<Rig> {
  const { data: company } = await admin
    .from('companies')
    .insert({ name_ar: `شركة ${tag} ${RUN}`, commercial_registration: `SEP-${tag}-${RUN}` })
    .select('id').single<{ id: string }>();
  const companyId = company!.id;

  const { data: branch } = await admin
    .from('branches')
    .insert({ company_id: companyId, name_ar: `فرع ${tag}` })
    .select('id').single<{ id: string }>();
  const branchId = branch!.id;

  const { data: tc } = await admin
    .from('transport_companies')
    .insert({
      name_ar: `ناقل ${tag} ${RUN}`, commercial_registration: `SEP-TC-${tag}-${RUN}`,
      ncwm_license_number: `SEP-NCWM-${tag}-${RUN}`, ncwm_license_expiry: '2030-01-01',
    })
    .select('id').single<{ id: string }>();
  const transportCompanyId = tc!.id;

  const { data: driver } = await admin
    .from('drivers')
    .insert({
      transport_company_id: transportCompanyId, name_ar: `سائق ${tag}`,
      license_number: `SEP-DRV-${tag}-${RUN}`, license_expiry: '2030-01-01',
    })
    .select('id').single<{ id: string }>();
  const driverId = driver!.id;

  const { data: vehicle } = await admin
    .from('vehicles')
    .insert({
      transport_company_id: transportCompanyId, plate_number: `SEP-${tag}-${RUN}`,
      type: 'medium_truck', waste_license_type: 'general',
      ncwm_license_number: `SEP-VEH-${tag}-${RUN}`, ncwm_license_expiry: '2030-01-01',
    })
    .select('id').single<{ id: string }>();
  const vehicleId = vehicle!.id;

  return { companyId, branchId, transportCompanyId, driverId, vehicleId };
}

async function makeOwner(email: string, kind: 'company' | 'transport_company', tenantId: string): Promise<SupabaseClient> {
  const { data: created, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (error || !created.user) throw new Error(`createUser failed (${email}): ${error?.message}`);
  const { error: memErr } = kind === 'company'
    ? await admin.from('memberships').insert({ user_id: created.user.id, role: 'owner', company_id: tenantId })
    : await admin.from('memberships').insert({ user_id: created.user.id, role: 'dispatcher', transport_company_id: tenantId });
  if (memErr) throw new Error(`membership insert failed (${email}): ${memErr.message}`);
  return sessionClient(email);
}

async function linkCompanyToTransport(companyId: string, transportCompanyId: string): Promise<string> {
  const { data } = await admin
    .from('company_transporters')
    .insert({ company_id: companyId, transport_company_id: transportCompanyId, status: 'active' })
    .select('id').single<{ id: string }>();
  return data!.id;
}

describe('CP8 dispatcher assignment separation (migration 044)', () => {
  const cleanupUserIds: string[] = [];
  const cleanupCompanyIds: string[] = [];
  const cleanupTcIds: string[] = [];
  const cleanupLinkIds: string[] = [];
  const cleanupAssignmentIds: string[] = [];

  afterAll(async () => {
    if (cleanupAssignmentIds.length) await admin.from('pickup_assignments').delete().in('id', cleanupAssignmentIds);
    if (cleanupLinkIds.length) await admin.from('company_transporters').delete().in('id', cleanupLinkIds);
    for (const uid of cleanupUserIds) {
      await admin.from('memberships').delete().eq('user_id', uid);
      await admin.from('profiles').delete().eq('id', uid);
      await admin.auth.admin.deleteUser(uid).catch(() => {});
    }
    if (cleanupTcIds.length) await admin.from('transport_companies').delete().in('id', cleanupTcIds);
    if (cleanupCompanyIds.length) await admin.from('companies').delete().in('id', cleanupCompanyIds);
  });

  it('1. company creates a request with driver_id/vehicle_id NULL, status requested', async () => {
    const rig = await makeRig('happy');
    cleanupCompanyIds.push(rig.companyId);
    cleanupTcIds.push(rig.transportCompanyId);
    grandfatherCompliance('company', rig.companyId);

    const ownerEmail = `sep-owner-${RUN}-1@company.sanad360.dev`;
    const ownerClient = await makeOwner(ownerEmail, 'company', rig.companyId);
    cleanupUserIds.push((await admin.auth.admin.listUsers()).data.users.find((u) => u.email === ownerEmail)!.id);

    const { data, error } = await ownerClient
      .from('pickup_assignments')
      .insert({
        company_id: rig.companyId, branch_id: rig.branchId,
        scheduled_at: new Date().toISOString(), status: 'requested',
      })
      .select('id, status, driver_id, vehicle_id')
      .single<{ id: string; status: string; driver_id: string | null; vehicle_id: string | null }>();

    expect(error).toBeNull();
    expect(data!.status).toBe('requested');
    expect(data!.driver_id).toBeNull();
    expect(data!.vehicle_id).toBeNull();
    cleanupAssignmentIds.push(data!.id);
  });

  it('2. company CANNOT set driver_id/vehicle_id on INSERT (raw API)', async () => {
    const rig = await makeRig('ins-bug');
    cleanupCompanyIds.push(rig.companyId);
    cleanupTcIds.push(rig.transportCompanyId);
    grandfatherCompliance('company', rig.companyId);
    grandfatherCompliance('transport_company', rig.transportCompanyId);
    grandfatherCompliance('driver', rig.driverId);
    grandfatherCompliance('vehicle', rig.vehicleId);

    const ownerEmail = `sep-owner-${RUN}-2@company.sanad360.dev`;
    const ownerClient = await makeOwner(ownerEmail, 'company', rig.companyId);
    cleanupUserIds.push((await admin.auth.admin.listUsers()).data.users.find((u) => u.email === ownerEmail)!.id);

    const { data, error } = await ownerClient
      .from('pickup_assignments')
      .insert({
        company_id: rig.companyId, branch_id: rig.branchId,
        driver_id: rig.driverId, vehicle_id: rig.vehicleId,
        scheduled_at: new Date().toISOString(),
      })
      .select('id');

    expect(error).not.toBeNull();
    expect(data).toBeNull();
  });

  it('3. company CANNOT set driver_id/vehicle_id on UPDATE (raw API) — trigger guard', async () => {
    const rig = await makeRig('upd-bug');
    cleanupCompanyIds.push(rig.companyId);
    cleanupTcIds.push(rig.transportCompanyId);
    grandfatherCompliance('company', rig.companyId);
    grandfatherCompliance('transport_company', rig.transportCompanyId);
    grandfatherCompliance('driver', rig.driverId);
    grandfatherCompliance('vehicle', rig.vehicleId);

    const ownerEmail = `sep-owner-${RUN}-3@company.sanad360.dev`;
    const ownerClient = await makeOwner(ownerEmail, 'company', rig.companyId);
    cleanupUserIds.push((await admin.auth.admin.listUsers()).data.users.find((u) => u.email === ownerEmail)!.id);

    const { data: req } = await ownerClient
      .from('pickup_assignments')
      .insert({
        company_id: rig.companyId, branch_id: rig.branchId,
        scheduled_at: new Date().toISOString(), status: 'requested',
      })
      .select('id').single<{ id: string }>();
    cleanupAssignmentIds.push(req!.id);

    const { error } = await ownerClient
      .from('pickup_assignments')
      .update({ driver_id: rig.driverId, vehicle_id: rig.vehicleId })
      .eq('id', req!.id);

    expect(error).not.toBeNull();
    expect(error!.code).toBe('P0032');
    expect(error!.message).toMatch(/COMPANY_MAY_NOT_ASSIGN/);

    const { data: unchanged } = await admin
      .from('pickup_assignments').select('driver_id, vehicle_id, status').eq('id', req!.id)
      .single<{ driver_id: string | null; vehicle_id: string | null; status: string }>();
    expect(unchanged!.driver_id).toBeNull();
    expect(unchanged!.vehicle_id).toBeNull();
    expect(unchanged!.status).toBe('requested');
  });

  it('4. a linked transporter\'s dispatcher CAN assign its own driver+vehicle, transitioning requested -> pending', async () => {
    const rig = await makeRig('assign-ok');
    cleanupCompanyIds.push(rig.companyId);
    cleanupTcIds.push(rig.transportCompanyId);
    grandfatherCompliance('company', rig.companyId);
    grandfatherCompliance('transport_company', rig.transportCompanyId);
    grandfatherCompliance('driver', rig.driverId);
    grandfatherCompliance('vehicle', rig.vehicleId);
    const linkId = await linkCompanyToTransport(rig.companyId, rig.transportCompanyId);
    cleanupLinkIds.push(linkId);

    const { data: req } = await admin
      .from('pickup_assignments')
      .insert({ company_id: rig.companyId, branch_id: rig.branchId, scheduled_at: new Date().toISOString(), status: 'requested' })
      .select('id').single<{ id: string }>();
    cleanupAssignmentIds.push(req!.id);

    const dispatcherEmail = `sep-dispatcher-${RUN}-4@transport.sanad360.dev`;
    const dispatcherClient = await makeOwner(dispatcherEmail, 'transport_company', rig.transportCompanyId);
    cleanupUserIds.push((await admin.auth.admin.listUsers()).data.users.find((u) => u.email === dispatcherEmail)!.id);

    const { data: assigned, error } = await dispatcherClient
      .from('pickup_assignments')
      .update({ driver_id: rig.driverId, vehicle_id: rig.vehicleId, status: 'pending' })
      .eq('id', req!.id)
      .select('id, status, driver_id, vehicle_id')
      .single<{ id: string; status: string; driver_id: string; vehicle_id: string }>();

    expect(error).toBeNull();
    expect(assigned!.status).toBe('pending');
    expect(assigned!.driver_id).toBe(rig.driverId);
    expect(assigned!.vehicle_id).toBe(rig.vehicleId);
  });

  it('5. a dispatcher CANNOT assign another transporter\'s fleet onto its own linked company\'s request', async () => {
    const rig = await makeRig('assign-wrongfleet');
    const otherTc = await makeRig('assign-otherfleet'); // only its driver/vehicle/transport_company_id are used
    cleanupCompanyIds.push(rig.companyId, otherTc.companyId);
    cleanupTcIds.push(rig.transportCompanyId, otherTc.transportCompanyId);
    grandfatherCompliance('company', rig.companyId);
    grandfatherCompliance('transport_company', rig.transportCompanyId);
    grandfatherCompliance('driver', rig.driverId);
    grandfatherCompliance('vehicle', rig.vehicleId);
    grandfatherCompliance('transport_company', otherTc.transportCompanyId);
    grandfatherCompliance('driver', otherTc.driverId);
    grandfatherCompliance('vehicle', otherTc.vehicleId);
    const linkId = await linkCompanyToTransport(rig.companyId, rig.transportCompanyId);
    cleanupLinkIds.push(linkId);

    const { data: req } = await admin
      .from('pickup_assignments')
      .insert({ company_id: rig.companyId, branch_id: rig.branchId, scheduled_at: new Date().toISOString(), status: 'requested' })
      .select('id').single<{ id: string }>();
    cleanupAssignmentIds.push(req!.id);

    const dispatcherEmail = `sep-dispatcher-${RUN}-5@transport.sanad360.dev`;
    const dispatcherClient = await makeOwner(dispatcherEmail, 'transport_company', rig.transportCompanyId);
    cleanupUserIds.push((await admin.auth.admin.listUsers()).data.users.find((u) => u.email === dispatcherEmail)!.id);

    // Attempts to assign OTHER transport company's driver+vehicle — the row
    // IS reachable (own company is linked), but the fleet doesn't belong to
    // the caller.
    const { error } = await dispatcherClient
      .from('pickup_assignments')
      .update({ driver_id: otherTc.driverId, vehicle_id: otherTc.vehicleId, status: 'pending' })
      .eq('id', req!.id);

    expect(error).not.toBeNull();
    expect(error!.code).toBe('P0029'); // ASSIGN_DRIVER_NOT_OWN_FLEET (checked before vehicle)
    expect(error!.message).toMatch(/ASSIGN_DRIVER_NOT_OWN_FLEET/);

    const { data: unchanged } = await admin
      .from('pickup_assignments').select('status, driver_id').eq('id', req!.id)
      .single<{ status: string; driver_id: string | null }>();
    expect(unchanged!.status).toBe('requested');
    expect(unchanged!.driver_id).toBeNull();
  });

  it('6. a dispatcher CANNOT reach a NON-linked company\'s request at all (RLS makes it invisible)', async () => {
    const rig = await makeRig('assign-nolink');       // transport side
    const outsiderCompany = await makeRig('assign-outsider-co'); // company side, NOT linked
    cleanupCompanyIds.push(rig.companyId, outsiderCompany.companyId);
    cleanupTcIds.push(rig.transportCompanyId, outsiderCompany.transportCompanyId);
    grandfatherCompliance('company', outsiderCompany.companyId);
    grandfatherCompliance('transport_company', rig.transportCompanyId);
    grandfatherCompliance('driver', rig.driverId);
    grandfatherCompliance('vehicle', rig.vehicleId);
    // Deliberately NO company_transporters link between rig.transportCompanyId
    // and outsiderCompany.companyId.

    const { data: req } = await admin
      .from('pickup_assignments')
      .insert({
        company_id: outsiderCompany.companyId, branch_id: outsiderCompany.branchId,
        scheduled_at: new Date().toISOString(), status: 'requested',
      })
      .select('id').single<{ id: string }>();
    cleanupAssignmentIds.push(req!.id);

    const dispatcherEmail = `sep-dispatcher-${RUN}-6@transport.sanad360.dev`;
    const dispatcherClient = await makeOwner(dispatcherEmail, 'transport_company', rig.transportCompanyId);
    cleanupUserIds.push((await admin.auth.admin.listUsers()).data.users.find((u) => u.email === dispatcherEmail)!.id);

    const { data, error } = await dispatcherClient
      .from('pickup_assignments')
      .update({ driver_id: rig.driverId, vehicle_id: rig.vehicleId, status: 'pending' })
      .eq('id', req!.id)
      .select('id');

    // RLS USING excludes the row entirely for this caller — no error, just
    // zero rows matched/returned (same shape as any other cross-tenant
    // "invisible row" RLS test in this suite).
    expect(error).toBeNull();
    expect(data).toEqual([]);

    const { data: unchanged } = await admin
      .from('pickup_assignments').select('status, driver_id').eq('id', req!.id)
      .single<{ status: string; driver_id: string | null }>();
    expect(unchanged!.status).toBe('requested');
    expect(unchanged!.driver_id).toBeNull();
  });

  it('7a. the gate blocks assignment of a doc-expired (non-exempt) DRIVER at assign time', async () => {
    const rig = await makeRig('gate-driver');
    cleanupCompanyIds.push(rig.companyId);
    cleanupTcIds.push(rig.transportCompanyId);
    grandfatherCompliance('company', rig.companyId);
    grandfatherCompliance('transport_company', rig.transportCompanyId);
    grandfatherCompliance('vehicle', rig.vehicleId);
    // Driver deliberately NOT grandfathered — non-exempt, zero required docs.
    const linkId = await linkCompanyToTransport(rig.companyId, rig.transportCompanyId);
    cleanupLinkIds.push(linkId);

    const { data: req } = await admin
      .from('pickup_assignments')
      .insert({ company_id: rig.companyId, branch_id: rig.branchId, scheduled_at: new Date().toISOString(), status: 'requested' })
      .select('id').single<{ id: string }>();
    cleanupAssignmentIds.push(req!.id);

    const dispatcherEmail = `sep-dispatcher-${RUN}-7a@transport.sanad360.dev`;
    const dispatcherClient = await makeOwner(dispatcherEmail, 'transport_company', rig.transportCompanyId);
    cleanupUserIds.push((await admin.auth.admin.listUsers()).data.users.find((u) => u.email === dispatcherEmail)!.id);

    const { error } = await dispatcherClient
      .from('pickup_assignments')
      .update({ driver_id: rig.driverId, vehicle_id: rig.vehicleId, status: 'pending' })
      .eq('id', req!.id);

    expect(error).not.toBeNull();
    expect(error!.code).toBe('P0023');
    expect(error!.message).toMatch(/DRIVER_NOT_ACTIVE/);
  });

  it('7b. the gate blocks assignment of a doc-expired (non-exempt) VEHICLE at assign time', async () => {
    const rig = await makeRig('gate-vehicle');
    cleanupCompanyIds.push(rig.companyId);
    cleanupTcIds.push(rig.transportCompanyId);
    grandfatherCompliance('company', rig.companyId);
    grandfatherCompliance('transport_company', rig.transportCompanyId);
    grandfatherCompliance('driver', rig.driverId);
    // Vehicle deliberately NOT grandfathered.
    const linkId = await linkCompanyToTransport(rig.companyId, rig.transportCompanyId);
    cleanupLinkIds.push(linkId);

    const { data: req } = await admin
      .from('pickup_assignments')
      .insert({ company_id: rig.companyId, branch_id: rig.branchId, scheduled_at: new Date().toISOString(), status: 'requested' })
      .select('id').single<{ id: string }>();
    cleanupAssignmentIds.push(req!.id);

    const dispatcherEmail = `sep-dispatcher-${RUN}-7b@transport.sanad360.dev`;
    const dispatcherClient = await makeOwner(dispatcherEmail, 'transport_company', rig.transportCompanyId);
    cleanupUserIds.push((await admin.auth.admin.listUsers()).data.users.find((u) => u.email === dispatcherEmail)!.id);

    const { error } = await dispatcherClient
      .from('pickup_assignments')
      .update({ driver_id: rig.driverId, vehicle_id: rig.vehicleId, status: 'pending' })
      .eq('id', req!.id);

    expect(error).not.toBeNull();
    expect(error!.code).toBe('P0024');
    expect(error!.message).toMatch(/VEHICLE_NOT_ACTIVE/);
  });

  it('7c. the gate blocks assignment for a doc-expired (non-exempt) TRANSPORT_COMPANY at assign time', async () => {
    const rig = await makeRig('gate-tc');
    cleanupCompanyIds.push(rig.companyId);
    cleanupTcIds.push(rig.transportCompanyId);
    grandfatherCompliance('company', rig.companyId);
    grandfatherCompliance('driver', rig.driverId);
    grandfatherCompliance('vehicle', rig.vehicleId);
    // transport_company itself deliberately NOT grandfathered.
    const linkId = await linkCompanyToTransport(rig.companyId, rig.transportCompanyId);
    cleanupLinkIds.push(linkId);

    const { data: req } = await admin
      .from('pickup_assignments')
      .insert({ company_id: rig.companyId, branch_id: rig.branchId, scheduled_at: new Date().toISOString(), status: 'requested' })
      .select('id').single<{ id: string }>();
    cleanupAssignmentIds.push(req!.id);

    const dispatcherEmail = `sep-dispatcher-${RUN}-7c@transport.sanad360.dev`;
    const dispatcherClient = await makeOwner(dispatcherEmail, 'transport_company', rig.transportCompanyId);
    cleanupUserIds.push((await admin.auth.admin.listUsers()).data.users.find((u) => u.email === dispatcherEmail)!.id);

    const { error } = await dispatcherClient
      .from('pickup_assignments')
      .update({ driver_id: rig.driverId, vehicle_id: rig.vehicleId, status: 'pending' })
      .eq('id', req!.id);

    expect(error).not.toBeNull();
    expect(error!.code).toBe('P0027');
    expect(error!.message).toMatch(/TRANSPORT_COMPANY_NOT_ACTIVE/);
  });

  it('8. a doc-expired (non-exempt) company is blocked at REQUEST time (INSERT), before any driver/vehicle', async () => {
    const rig = await makeRig('gate-company');
    cleanupCompanyIds.push(rig.companyId);
    cleanupTcIds.push(rig.transportCompanyId);
    // Company deliberately NOT grandfathered.
    grandfatherCompliance('transport_company', rig.transportCompanyId);
    grandfatherCompliance('driver', rig.driverId);
    grandfatherCompliance('vehicle', rig.vehicleId);

    const ownerEmail = `sep-owner-${RUN}-8@company.sanad360.dev`;
    const ownerClient = await makeOwner(ownerEmail, 'company', rig.companyId);
    cleanupUserIds.push((await admin.auth.admin.listUsers()).data.users.find((u) => u.email === ownerEmail)!.id);

    const { data, error } = await ownerClient
      .from('pickup_assignments')
      .insert({
        company_id: rig.companyId, branch_id: rig.branchId,
        scheduled_at: new Date().toISOString(), status: 'requested',
      })
      .select('id');

    expect(error).not.toBeNull();
    expect(error!.code).toBe('P0026');
    expect(error!.message).toMatch(/COMPANY_NOT_ACTIVE/);
    expect(data).toBeNull();
  });
});
