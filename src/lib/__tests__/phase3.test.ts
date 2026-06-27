/**
 * Phase 3 Acceptance Tests
 *
 * Covers the new Phase 3 contracts against a live local Supabase:
 *   1. Assignment lifecycle: create → accept → complete → pickup_event linked
 *   2. Tenant isolation on pickup_assignments (company B user sees 0 of A's rows)
 *   3. Alert acknowledgement persists (and dedups via UNIQUE)
 *   4. Notification mark-read persists
 *
 * Prerequisites:
 *   supabase db reset          (applies 001 + 002 + 003 + seed)
 *   .env exports VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
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
  managerEmail: 'manager@tadweer360.dev',
  managerPassword: 'DevPass1234!',
  driverEmail: '0501234567@driver.tadweer360.com',
  driverPassword: 'DevPass1234!',
  managerUserId: 'f0000000-0000-0000-0000-000000000001',
  driverUserId: 'f0000000-0000-0000-0000-000000000002',
};

const cleanup = {
  assignmentIds: [] as string[],
  eventIds: [] as string[],
  ackIds: [] as string[],
  notifIds: [] as string[],
  company2Id: null as string | null,
  branch2Id: null as string | null,
  user2Id: null as string | null,
};

async function sessionClient(email: string, password: string): Promise<{ client: SupabaseClient; jwt: string }> {
  const { data, error } = await anon.auth.signInWithPassword({ email, password });
  if (error || !data.session) throw new Error(`sign-in failed (${email}): ${error?.message}`);
  const jwt = data.session.access_token;
  const client = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });
  return { client, jwt };
}

describe('Phase 3 Acceptance Tests', () => {
  let managerClient: SupabaseClient;
  let driverClient: SupabaseClient;

  beforeAll(async () => {
    const { data: seedCheck } = await admin
      .from('companies').select('id').eq('id', SEED.companyId).single();
    if (!seedCheck) throw new Error('Seed missing — run `supabase db reset`.');

    managerClient = (await sessionClient(SEED.managerEmail, SEED.managerPassword)).client;
    driverClient = (await sessionClient(SEED.driverEmail, SEED.driverPassword)).client;

    // ── Second tenant for isolation: company2 + owner user2 ──
    const stamp = Date.now();
    const { data: u2 } = await admin.auth.admin.createUser({
      email: `owner2-${stamp}@tadweer360.dev`,
      password: 'DevPass1234!',
      email_confirm: true,
      user_metadata: { name_ar: 'مالك ثانٍ' },
    });
    cleanup.user2Id = u2?.user?.id ?? null;

    const { data: c2 } = await admin
      .from('companies')
      .insert({ name_ar: 'شركة العزل الثانية', commercial_registration: `ISO3-${stamp}` })
      .select('id').single<{ id: string }>();
    cleanup.company2Id = c2?.id ?? null;

    if (c2) {
      const { data: b2 } = await admin
        .from('branches')
        .insert({ company_id: c2.id, name_ar: 'فرع العزل', geofence_radius_m: 150 })
        .select('id').single<{ id: string }>();
      cleanup.branch2Id = b2?.id ?? null;

      if (cleanup.user2Id) {
        await admin.from('memberships').insert({
          user_id: cleanup.user2Id, role: 'owner', company_id: c2.id,
        });
      }
    }
  });

  afterAll(async () => {
    if (cleanup.assignmentIds.length) await admin.from('pickup_assignments').delete().in('id', cleanup.assignmentIds);
    if (cleanup.eventIds.length) await admin.from('pickup_events').delete().in('id', cleanup.eventIds);
    if (cleanup.ackIds.length) await admin.from('alert_acknowledgements').delete().in('id', cleanup.ackIds);
    if (cleanup.notifIds.length) await admin.from('notifications').delete().in('id', cleanup.notifIds);
    if (cleanup.branch2Id) await admin.from('branches').delete().eq('id', cleanup.branch2Id);
    if (cleanup.company2Id) {
      await admin.from('memberships').delete().eq('company_id', cleanup.company2Id);
      await admin.from('companies').delete().eq('id', cleanup.company2Id);
    }
    if (cleanup.user2Id) await admin.auth.admin.deleteUser(cleanup.user2Id);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  it('1. Assignment lifecycle: create → accept → complete → pickup_event linked', async () => {
    // Manager (company member) creates the assignment.
    const { data: created, error: createErr } = await managerClient
      .from('pickup_assignments')
      .insert({
        company_id: SEED.companyId,
        branch_id: SEED.branchId,
        driver_id: SEED.driverId,
        vehicle_id: SEED.vehicleId,
        scheduled_at: new Date(Date.now() + 3600_000).toISOString(),
        notes: 'phase3 lifecycle',
      })
      .select()
      .single<{ id: string; status: string }>();

    expect(createErr).toBeNull();
    expect(created).not.toBeNull();
    expect(created!.status).toBe('pending');
    cleanup.assignmentIds.push(created!.id);

    // Driver accepts (driver is in the assigned transport company → UPDATE allowed).
    const { data: accepted, error: acceptErr } = await driverClient
      .from('pickup_assignments')
      .update({ status: 'accepted' })
      .eq('id', created!.id)
      .select('status')
      .single<{ status: string }>();
    expect(acceptErr).toBeNull();
    expect(accepted!.status).toBe('accepted');

    // Driver starts.
    await driverClient.from('pickup_assignments')
      .update({ status: 'in_progress' }).eq('id', created!.id);

    // Driver creates a real pickup_event (revision 1) for the work.
    const { data: ev, error: evErr } = await driverClient
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
        weight_kg: 33,
        photo_path: 'p/p.jpg',
        signature_path: 'p/s.png',
      })
      .select('id')
      .single<{ id: string }>();
    expect(evErr).toBeNull();
    cleanup.eventIds.push(ev!.id);

    // Complete: set status + link pickup_event_id.
    const { data: completed, error: completeErr } = await driverClient
      .from('pickup_assignments')
      .update({ status: 'completed', pickup_event_id: ev!.id })
      .eq('id', created!.id)
      .select('status, pickup_event_id')
      .single<{ status: string; pickup_event_id: string }>();

    expect(completeErr).toBeNull();
    expect(completed!.status).toBe('completed');
    expect(completed!.pickup_event_id).toBe(ev!.id);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  it('2. Tenant isolation: company2 owner sees 0 of company1 assignments', async () => {
    if (!cleanup.company2Id || !cleanup.user2Id) {
      console.log('SKIP: company2 not created');
      return;
    }
    // Ensure at least one company1 assignment exists.
    const { data: a1 } = await admin
      .from('pickup_assignments')
      .insert({
        company_id: SEED.companyId,
        branch_id: SEED.branchId,
        driver_id: SEED.driverId,
        vehicle_id: SEED.vehicleId,
        scheduled_at: new Date().toISOString(),
      })
      .select('id').single<{ id: string }>();
    if (a1) cleanup.assignmentIds.push(a1.id);

    const owner2 = (await sessionClient(
      (await admin.auth.admin.getUserById(cleanup.user2Id)).data.user!.email!,
      'DevPass1234!'
    )).client;

    const { data, error } = await owner2
      .from('pickup_assignments')
      .select('id')
      .eq('company_id', SEED.companyId);

    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  it('3. Alert acknowledgement persists and dedups', async () => {
    const alertKey = `driver_expiry:${SEED.driverId}`;
    // Clean any prior ack for determinism.
    await admin.from('alert_acknowledgements')
      .delete().eq('company_id', SEED.companyId).eq('alert_key', alertKey);

    const { data: ack, error } = await managerClient
      .from('alert_acknowledgements')
      .insert({ company_id: SEED.companyId, alert_key: alertKey })
      .select()
      .single<{ id: string }>();
    expect(error).toBeNull();
    expect(ack).not.toBeNull();
    cleanup.ackIds.push(ack!.id);

    // Persisted + visible to the same company.
    const { data: read } = await managerClient
      .from('alert_acknowledgements')
      .select('alert_key')
      .eq('company_id', SEED.companyId)
      .eq('alert_key', alertKey);
    expect(read).toHaveLength(1);

    // UNIQUE(company_id, alert_key) → second insert fails with 23505.
    const { error: dupErr } = await managerClient
      .from('alert_acknowledgements')
      .insert({ company_id: SEED.companyId, alert_key: alertKey });
    expect(dupErr).not.toBeNull();
    expect(dupErr!.code).toBe('23505');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  it('4. Notification mark-read persists', async () => {
    // Service role seeds a notification for the manager.
    const { data: notif } = await admin
      .from('notifications')
      .insert({
        profile_id: SEED.managerUserId,
        company_id: SEED.companyId,
        title_ar: 'تنبيه',
        title_en: 'Alert',
        body_ar: 'اختبار',
        body_en: 'test',
      })
      .select('id, is_read')
      .single<{ id: string; is_read: boolean }>();
    expect(notif!.is_read).toBe(false);
    cleanup.notifIds.push(notif!.id);

    // Manager marks it read (own row → UPDATE allowed).
    const { error: updErr } = await managerClient
      .from('notifications')
      .update({ is_read: true })
      .eq('id', notif!.id);
    expect(updErr).toBeNull();

    // Persisted.
    const { data: after } = await managerClient
      .from('notifications')
      .select('is_read')
      .eq('id', notif!.id)
      .single<{ is_read: boolean }>();
    expect(after!.is_read).toBe(true);
  });
});
