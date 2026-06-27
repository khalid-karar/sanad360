/**
 * Grant Audit Tests — verifies that table-level GRANTs + RLS together
 * allow the correct authenticated writes (migration 007).
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * PostgreSQL checks table-level GRANTs *before* RLS policies. If `authenticated`
 * lacks a privilege, the write fails with 42501 ("permission denied") regardless
 * of what RLS allows. The existing suites mostly exercise writes as `service_role`,
 * which bypasses BOTH the grant layer and RLS — so a missing GRANT is invisible to
 * them (this is exactly how the `branches` bug, and the `drivers`/`vehicles` gap
 * fixed in 007, slipped through).
 *
 * PRINCIPLE: every assertion about a write path here runs as a signed-in
 * `authenticated` user (real JWT). `service_role` (`admin`) is used ONLY for
 * setup and teardown.
 *
 * Tests:
 *   1.  Driver        can INSERT a pickup_event
 *   2.  Driver        CANNOT UPDATE a pickup_event (append-only)
 *   3.  Driver        CANNOT DELETE a pickup_event (append-only)
 *   4.  Manager       can INSERT a branch for their company
 *   5.  Manager       can UPDATE a branch they own
 *   6.  Manager       can INSERT a company_transporters link
 *   7.  Manager       can UPDATE a company_transporters link (deactivate)
 *   8.  Manager       can INSERT a pickup_assignment
 *   9.  Manager       can UPDATE a pickup_assignment status
 *   10. Driver        can UPDATE a pickup_assignment status (their own)
 *   11. Manager       can UPDATE their own profile
 *   12. Authenticated can INSERT a notification (for themselves)
 *   13. Authenticated can UPDATE a notification (mark read)
 *   14. Manager       can INSERT an alert_acknowledgement
 *   15. Transport mgr can INSERT a driver        ← 007 grant
 *   16. Transport mgr can INSERT a vehicle       ← 007 grant
 *   17. Transport mgr can UPDATE a driver (deactivate)  ← 007 grant
 *   18. Authenticated CANNOT INSERT an audit_log row (trigger-only)
 *
 * Prerequisites:
 *   supabase db reset   (applies 001..007 + seed)
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

// service_role — setup/teardown ONLY (bypasses grants + RLS)
const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
// anon — used to sign users in
const anon = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });

const SEED = {
  companyId: 'a0000000-0000-0000-0000-000000000001',
  branchId: 'b0000000-0000-0000-0000-000000000001',
  transportCompanyId: 'c0000000-0000-0000-0000-000000000001',
  unlinkedTransportCompanyId: 'c0000000-0000-0000-0000-000000000002',
  driverId: 'd0000000-0000-0000-0000-000000000001',
  vehicleId: 'e0000000-0000-0000-0000-000000000001',
  managerUserId: 'f0000000-0000-0000-0000-000000000001',
  driverUserId: 'f0000000-0000-0000-0000-000000000002',
  dispatcherUserId: 'f0000000-0000-0000-0000-000000000003',
  managerEmail: 'manager@sanad360.dev',
  driverEmail: '0501234567@driver.sanad360.com',
  dispatcherEmail: 'dispatcher@sanad360.dev',
  password: 'DevPass1234!',
};

const TIMEOUT = 30_000;

/**
 * Sign in `email` ONCE and return a client whose every request carries that JWT.
 *
 * Sessions are cached per-email. This matters because repeatedly signing in the
 * SAME seed user (e.g. manager@sanad360.dev) on a shared anon client rotates that
 * user's GoTrue session, which can invalidate a JWT another concurrently-running
 * test file captured earlier (observed as a 401 in the phase-2 PDF suite). Signing
 * each user in exactly once — on its own isolated anon client — keeps every test
 * file's session stable.
 */
const sessionCache = new Map<string, SupabaseClient>();
async function sessionClient(email: string, password: string): Promise<SupabaseClient> {
  const cached = sessionCache.get(email);
  if (cached) return cached;
  const signer = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
  const { data, error } = await signer.auth.signInWithPassword({ email, password });
  if (error || !data.session) throw new Error(`sign-in failed (${email}): ${error?.message}`);
  const client = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${data.session.access_token}` } },
  });
  sessionCache.set(email, client);
  return client;
}

function isPermissionDenied(error: { message?: string; code?: string } | null): boolean {
  if (!error) return false;
  const m = (error.message ?? '').toLowerCase();
  return (
    m.includes('permission denied') ||
    m.includes('insufficient privilege') ||
    m.includes('violates row-level security') ||
    error.code === '42501' ||
    error.code === '42P01'
  );
}

function basePickupPayload(createdBy: string | null = null, overrides: Record<string, unknown> = {}) {
  return {
    logical_id: crypto.randomUUID(),
    revision: 1,
    company_id: SEED.companyId,
    branch_id: SEED.branchId,
    transport_company_id: SEED.transportCompanyId,
    driver_id: SEED.driverId,
    vehicle_id: SEED.vehicleId,
    waste_types: ['organic'],
    weight_kg: 33.3,
    gps_lat: 24.6877,
    gps_lng: 46.6876,
    gps_accuracy_m: 10,
    ...(createdBy ? { created_by: createdBy } : {}),
    ...overrides,
  };
}

// ── Teardown tracking ────────────────────────────────────────────────────────
const cleanup = {
  pickupEventIds: [] as string[],
  branchIds: [] as string[],
  ctLinkIds: [] as string[],
  assignmentIds: [] as string[],
  notificationIds: [] as string[],
  alertAckIds: [] as string[],
  driverIds: [] as string[],
  vehicleIds: [] as string[],
  membershipIds: [] as string[],
  authUserIds: [] as string[],
};

// We provision our OWN users instead of reusing the shared seed users for the
// company-manager / transport-owner write tests. Reason: signing in a seed user
// here would rotate that user's GoTrue session and can 401 a JWT another test
// file (phase-2 PDF suite) captured for the same seed user earlier in the run.
// Dedicated users keep this file fully self-contained.
const stamp = Date.now();
const companyMgr = {
  email: `grant-audit-mgr-${stamp}@sanad360.dev`,
  password: 'DevPass1234!',
  userId: '' as string,
};
// A transport-company OWNER for driver/vehicle write tests (vehicle INSERT /
// driver UPDATE RLS require owner|manager; the seed has only a dispatcher there).
const transportMgr = {
  email: `grant-audit-transport-${stamp}@sanad360.dev`,
  password: 'DevPass1234!',
  userId: '' as string,
};

/** Create an auth user (+ profile via trigger) and a membership; track for teardown. */
async function provision(
  email: string,
  password: string,
  role: string,
  tenant: { company_id?: string; transport_company_id?: string },
): Promise<string> {
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { name_ar: 'مستخدم اختبار' },
  });
  if (createErr || !created.user) throw new Error(`createUser failed (${email}): ${createErr?.message}`);
  cleanup.authUserIds.push(created.user.id);

  const { data: mem, error: memErr } = await admin
    .from('memberships')
    .insert({ user_id: created.user.id, role, ...tenant })
    .select('id')
    .single<{ id: string }>();
  if (memErr) throw new Error(`membership insert failed (${email}): ${memErr.message}`);
  cleanup.membershipIds.push(mem.id);
  return created.user.id;
}

beforeAll(async () => {
  // Sanity: seed present
  const { data } = await admin.from('companies').select('id').eq('id', SEED.companyId).single();
  if (!data) throw new Error('Seed data not found. Run `supabase db reset`, then retry.');

  companyMgr.userId = await provision(companyMgr.email, companyMgr.password, 'manager', {
    company_id: SEED.companyId,
  });
  transportMgr.userId = await provision(transportMgr.email, transportMgr.password, 'owner', {
    transport_company_id: SEED.transportCompanyId,
  });
}, TIMEOUT);

afterAll(async () => {
  // FK-safe order: children before parents. service_role bypasses the
  // append-only REVOKEs, so it can DELETE pickup_events here.
  if (cleanup.assignmentIds.length) await admin.from('pickup_assignments').delete().in('id', cleanup.assignmentIds);
  if (cleanup.pickupEventIds.length) await admin.from('pickup_events').delete().in('id', cleanup.pickupEventIds);
  if (cleanup.notificationIds.length) await admin.from('notifications').delete().in('id', cleanup.notificationIds);
  if (cleanup.alertAckIds.length) await admin.from('alert_acknowledgements').delete().in('id', cleanup.alertAckIds);
  if (cleanup.ctLinkIds.length) await admin.from('company_transporters').delete().in('id', cleanup.ctLinkIds);
  if (cleanup.vehicleIds.length) await admin.from('vehicles').delete().in('id', cleanup.vehicleIds);
  if (cleanup.driverIds.length) await admin.from('drivers').delete().in('id', cleanup.driverIds);
  if (cleanup.branchIds.length) await admin.from('branches').delete().in('id', cleanup.branchIds);
  if (cleanup.membershipIds.length) await admin.from('memberships').delete().in('id', cleanup.membershipIds);
  for (const uid of cleanup.authUserIds) {
    await admin.auth.admin.deleteUser(uid).catch(() => {});
  }
  await anon.auth.signOut();
}, TIMEOUT);

// ═══════════════════════════════════════════════════════════════════════════
describe('Grant audit — authenticated write paths (migration 007)', () => {
  // ── pickup_events (append-only) ──────────────────────────────────────────
  it(
    '1. Driver can INSERT a pickup_event',
    async () => {
      const driver = await sessionClient(SEED.driverEmail, SEED.password);
      const { data, error } = await driver
        .from('pickup_events')
        .insert(basePickupPayload(SEED.driverUserId))
        .select('id')
        .single<{ id: string }>();
      expect(error).toBeNull();
      expect(data?.id).toBeTruthy();
      if (data) cleanup.pickupEventIds.push(data.id);
    },
    TIMEOUT,
  );

  it(
    '2. Driver CANNOT UPDATE a pickup_event (append-only)',
    async () => {
      const id = (
        await admin.from('pickup_events').insert(basePickupPayload()).select('id').single<{ id: string }>()
      ).data!.id;
      cleanup.pickupEventIds.push(id);

      const driver = await sessionClient(SEED.driverEmail, SEED.password);
      const { error } = await driver.from('pickup_events').update({ notes: 'tamper' }).eq('id', id);
      expect(isPermissionDenied(error)).toBe(true);
    },
    TIMEOUT,
  );

  it(
    '3. Driver CANNOT DELETE a pickup_event (append-only)',
    async () => {
      const id = (
        await admin.from('pickup_events').insert(basePickupPayload()).select('id').single<{ id: string }>()
      ).data!.id;
      cleanup.pickupEventIds.push(id);

      const driver = await sessionClient(SEED.driverEmail, SEED.password);
      const { error } = await driver.from('pickup_events').delete().eq('id', id);
      expect(isPermissionDenied(error)).toBe(true);
    },
    TIMEOUT,
  );

  // ── branches ─────────────────────────────────────────────────────────────
  it(
    '4. Manager can INSERT a branch for their company',
    async () => {
      const mgr = await sessionClient(companyMgr.email, companyMgr.password);
      const { data, error } = await mgr
        .from('branches')
        .insert({ company_id: SEED.companyId, name_ar: 'فرع الاختبار', city: 'الرياض' })
        .select('id')
        .single<{ id: string }>();
      expect(error).toBeNull();
      expect(data?.id).toBeTruthy();
      if (data) cleanup.branchIds.push(data.id);
    },
    TIMEOUT,
  );

  it(
    '5. Manager can UPDATE a branch they own',
    async () => {
      const id = (
        await admin
          .from('branches')
          .insert({ company_id: SEED.companyId, name_ar: 'فرع للتعديل' })
          .select('id')
          .single<{ id: string }>()
      ).data!.id;
      cleanup.branchIds.push(id);

      const mgr = await sessionClient(companyMgr.email, companyMgr.password);
      const { error } = await mgr.from('branches').update({ name_en: 'Updated Branch' }).eq('id', id);
      expect(error).toBeNull();
    },
    TIMEOUT,
  );

  // ── company_transporters ─────────────────────────────────────────────────
  it(
    '6. Manager can INSERT a company_transporters link',
    async () => {
      const mgr = await sessionClient(companyMgr.email, companyMgr.password);
      const { data, error } = await mgr
        .from('company_transporters')
        .insert({
          company_id: SEED.companyId,
          transport_company_id: SEED.unlinkedTransportCompanyId,
          status: 'active',
        })
        .select('id')
        .single<{ id: string }>();
      expect(error).toBeNull();
      expect(data?.id).toBeTruthy();
      if (data) cleanup.ctLinkIds.push(data.id);
    },
    TIMEOUT,
  );

  it(
    '7. Manager can UPDATE a company_transporters link (deactivate)',
    async () => {
      // Use the seeded link (company a..1 ↔ transport c..1); restore after.
      const linkId = 'f1000000-0000-0000-0000-000000000001';
      const mgr = await sessionClient(companyMgr.email, companyMgr.password);
      const { error } = await mgr
        .from('company_transporters')
        .update({ status: 'inactive' })
        .eq('id', linkId);
      expect(error).toBeNull();
      // restore so other tests / seed expectations are unaffected
      await admin.from('company_transporters').update({ status: 'active' }).eq('id', linkId);
    },
    TIMEOUT,
  );

  // ── pickup_assignments ───────────────────────────────────────────────────
  it(
    '8. Manager can INSERT a pickup_assignment',
    async () => {
      const mgr = await sessionClient(companyMgr.email, companyMgr.password);
      const { data, error } = await mgr
        .from('pickup_assignments')
        .insert({
          company_id: SEED.companyId,
          branch_id: SEED.branchId,
          driver_id: SEED.driverId,
          vehicle_id: SEED.vehicleId,
          scheduled_at: new Date(Date.now() + 86_400_000).toISOString(),
          status: 'pending',
        })
        .select('id')
        .single<{ id: string }>();
      expect(error).toBeNull();
      expect(data?.id).toBeTruthy();
      if (data) cleanup.assignmentIds.push(data.id);
    },
    TIMEOUT,
  );

  it(
    '9. Manager can UPDATE a pickup_assignment status',
    async () => {
      const id = (
        await admin
          .from('pickup_assignments')
          .insert({
            company_id: SEED.companyId,
            branch_id: SEED.branchId,
            driver_id: SEED.driverId,
            vehicle_id: SEED.vehicleId,
            scheduled_at: new Date(Date.now() + 86_400_000).toISOString(),
            status: 'pending',
          })
          .select('id')
          .single<{ id: string }>()
      ).data!.id;
      cleanup.assignmentIds.push(id);

      const mgr = await sessionClient(companyMgr.email, companyMgr.password);
      const { error } = await mgr.from('pickup_assignments').update({ status: 'cancelled' }).eq('id', id);
      expect(error).toBeNull();
    },
    TIMEOUT,
  );

  it(
    '10. Driver can UPDATE a pickup_assignment status (their own)',
    async () => {
      const id = (
        await admin
          .from('pickup_assignments')
          .insert({
            company_id: SEED.companyId,
            branch_id: SEED.branchId,
            driver_id: SEED.driverId,
            vehicle_id: SEED.vehicleId,
            scheduled_at: new Date(Date.now() + 86_400_000).toISOString(),
            status: 'pending',
          })
          .select('id')
          .single<{ id: string }>()
      ).data!.id;
      cleanup.assignmentIds.push(id);

      const driver = await sessionClient(SEED.driverEmail, SEED.password);
      const { error } = await driver.from('pickup_assignments').update({ status: 'accepted' }).eq('id', id);
      expect(error).toBeNull();
    },
    TIMEOUT,
  );

  // ── profiles ─────────────────────────────────────────────────────────────
  it(
    '11. Manager can UPDATE their own profile',
    async () => {
      const mgr = await sessionClient(companyMgr.email, companyMgr.password);
      const { error } = await mgr
        .from('profiles')
        .update({ name_en: `Manager ${Date.now()}` })
        .eq('id', companyMgr.userId);
      expect(error).toBeNull();
    },
    TIMEOUT,
  );

  // ── notifications ────────────────────────────────────────────────────────
  it(
    '12. Authenticated user can INSERT a notification (for themselves)',
    async () => {
      const mgr = await sessionClient(companyMgr.email, companyMgr.password);
      const { data, error } = await mgr
        .from('notifications')
        .insert({
          profile_id: companyMgr.userId,
          company_id: SEED.companyId,
          title_ar: 'تنبيه',
          title_en: 'Alert',
        })
        .select('id')
        .single<{ id: string }>();
      expect(error).toBeNull();
      expect(data?.id).toBeTruthy();
      if (data) cleanup.notificationIds.push(data.id);
    },
    TIMEOUT,
  );

  it(
    '13. Authenticated user can UPDATE a notification (mark read)',
    async () => {
      const id = (
        await admin
          .from('notifications')
          .insert({ profile_id: companyMgr.userId, title_ar: 'ت', title_en: 'A' })
          .select('id')
          .single<{ id: string }>()
      ).data!.id;
      cleanup.notificationIds.push(id);

      const mgr = await sessionClient(companyMgr.email, companyMgr.password);
      const { error } = await mgr.from('notifications').update({ is_read: true }).eq('id', id);
      expect(error).toBeNull();
    },
    TIMEOUT,
  );

  // ── alert_acknowledgements ───────────────────────────────────────────────
  it(
    '14. Manager can INSERT an alert_acknowledgement',
    async () => {
      const mgr = await sessionClient(companyMgr.email, companyMgr.password);
      const { data, error } = await mgr
        .from('alert_acknowledgements')
        .insert({ company_id: SEED.companyId, alert_key: `test:${crypto.randomUUID()}` })
        .select('id')
        .single<{ id: string }>();
      expect(error).toBeNull();
      expect(data?.id).toBeTruthy();
      if (data) cleanup.alertAckIds.push(data.id);
    },
    TIMEOUT,
  );

  // ── drivers (007 grant) ──────────────────────────────────────────────────
  it(
    '15. Transport owner/manager can INSERT a driver',
    async () => {
      const tm = await sessionClient(transportMgr.email, transportMgr.password);
      const { data, error } = await tm
        .from('drivers')
        .insert({
          transport_company_id: SEED.transportCompanyId,
          name_ar: 'سائق جديد',
          license_number: `LIC-${Date.now()}`,
          license_expiry: '2028-01-01',
        })
        .select('id')
        .single<{ id: string }>();
      expect(error).toBeNull();
      expect(data?.id).toBeTruthy();
      if (data) cleanup.driverIds.push(data.id);
    },
    TIMEOUT,
  );

  // ── vehicles (007 grant) ─────────────────────────────────────────────────
  it(
    '16. Transport owner/manager can INSERT a vehicle',
    async () => {
      const tm = await sessionClient(transportMgr.email, transportMgr.password);
      const { data, error } = await tm
        .from('vehicles')
        .insert({
          transport_company_id: SEED.transportCompanyId,
          plate_number: `TEST ${Date.now() % 10000}`,
          type: 'medium_truck',
          waste_license_type: 'general',
          ncwm_license_expiry: '2028-01-01',
        })
        .select('id')
        .single<{ id: string }>();
      expect(error).toBeNull();
      expect(data?.id).toBeTruthy();
      if (data) cleanup.vehicleIds.push(data.id);
    },
    TIMEOUT,
  );

  it(
    '17. Transport owner/manager can UPDATE a driver (deactivate)',
    async () => {
      const id = (
        await admin
          .from('drivers')
          .insert({
            transport_company_id: SEED.transportCompanyId,
            name_ar: 'سائق للتعديل',
            license_number: `LIC-U-${Date.now()}`,
            license_expiry: '2028-01-01',
          })
          .select('id')
          .single<{ id: string }>()
      ).data!.id;
      cleanup.driverIds.push(id);

      const tm = await sessionClient(transportMgr.email, transportMgr.password);
      const { error } = await tm.from('drivers').update({ status: 'inactive' }).eq('id', id);
      expect(error).toBeNull();
    },
    TIMEOUT,
  );

  // ── audit_log (must stay trigger-only) ───────────────────────────────────
  it(
    '18. Authenticated user CANNOT INSERT an audit_log row (trigger-only)',
    async () => {
      const mgr = await sessionClient(companyMgr.email, companyMgr.password);
      const { error } = await mgr
        .from('audit_log')
        .insert({ user_id: companyMgr.userId, action: 'forged', entity_type: 'test' });
      expect(isPermissionDenied(error)).toBe(true);
    },
    TIMEOUT,
  );
});
