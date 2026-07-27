/**
 * CP8 Slice D, gap 6 — offline-replay idempotency
 * (src/lib/offline/pickupQueue.ts), against the REAL local Supabase, same
 * posture as every other test in this suite (not mocked).
 *
 * Found via the B audit: zero test files reference pickupQueue.ts at all,
 * despite its own header comment making three explicit idempotency claims:
 *   - storage uploads use upsert:false — an "already exists" error on retry
 *     means the previous attempt got through; treated as success
 *   - the ledger insert reuses the queued logical_id — a duplicate-key
 *     error (23505) resolves to the existing event id, not a new row
 *   - assignment completion is an UPDATE keyed by assignment id — idempotent
 *
 * `indexedDB` doesn't exist under Node/vitest — polyfilled via
 * `fake-indexeddb/auto` (new devDependency), imported before the module
 * under test so its `openDb()` sees a real (in-memory) IndexedDB.
 *
 * Assertions:
 *   1. A first drainQueue() succeeds: creates the pickup_events row (with
 *      the client-generated logical_id) and completes the assignment
 *   2. Re-enqueuing the SAME submission (simulating a crash after success
 *      but before the queue item was removed) and draining a second time
 *      is a genuine no-op: no duplicate pickup_events row, the assignment
 *      still points at the SAME event id, and both the storage
 *      "already exists" path and the ledger duplicate-key path are
 *      exercised for real (not mocked) since the second drain re-attempts
 *      every upload and the insert
 */
import 'fake-indexeddb/auto';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { grandfatherCompliance } from './testHelpers/complianceExempt';
import { supabase } from '../supabase';
import { enqueueSubmission, drainQueue, type QueuedSubmission } from '../offline/pickupQueue';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
if (!SERVICE_KEY) throw new Error('Set SUPABASE_SERVICE_ROLE_KEY in .env.');

const admin: SupabaseClient = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
const RUN = Date.now();
const PASSWORD = 'DevPass1234!';

// A tiny valid 1x1 PNG, base64 data URL — small, deterministic, real bytes.
const TINY_PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

describe('CP8 D gap 6: offline-replay idempotency (real Supabase, fake-indexeddb)', () => {
  let companyId = '';
  let branchId = '';
  let tcId = '';
  let driverRecordId = '';
  let driverUserId = '';
  let vehicleId = '';
  let assignmentId = '';
  const eventId = crypto.randomUUID();

  beforeAll(async () => {
    const { data: company } = await admin.from('companies').insert({
      name_ar: `شركة إعادة إرسال ${RUN}`, commercial_registration: `CP8OFF-${RUN}`,
    }).select('id').single<{ id: string }>();
    companyId = company!.id;
    grandfatherCompliance('company', companyId);

    const { data: branch } = await admin.from('branches').insert({
      company_id: companyId, name_ar: `فرع إعادة إرسال ${RUN}`,
    }).select('id').single<{ id: string }>();
    branchId = branch!.id;

    const { data: tc } = await admin.from('transport_companies').insert({
      name_ar: `ناقل إعادة إرسال ${RUN}`, commercial_registration: `CP8OFF-TC-${RUN}`,
    }).select('id').single<{ id: string }>();
    tcId = tc!.id;
    grandfatherCompliance('transport_company', tcId);

    // Storage RLS (008) scopes a transport-side member's evidence-bucket
    // write access to companies ACTIVELY linked via company_transporters —
    // without this, the driver's signature upload below fails 403 even
    // though the DB-level pickup_events insert would have succeeded.
    await admin.from('company_transporters').insert({
      company_id: companyId, transport_company_id: tcId, status: 'active',
    });

    const email = `off-driver-${RUN}@driver.sanad360.com`;
    const { data: driverAuth } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
    driverUserId = driverAuth!.user!.id;
    await admin.from('profiles').upsert({ id: driverUserId, name_ar: 'سائق إعادة إرسال' }, { onConflict: 'id' });
    await admin.from('memberships').insert({ user_id: driverUserId, role: 'driver', transport_company_id: tcId });

    const { data: driver } = await admin.from('drivers').insert({
      transport_company_id: tcId, profile_id: driverUserId, name_ar: 'سائق إعادة إرسال',
      license_number: `CP8OFF-DRV-${RUN}`, license_expiry: '2030-01-01',
    }).select('id').single<{ id: string }>();
    driverRecordId = driver!.id;
    grandfatherCompliance('driver', driverRecordId);

    const { data: vehicle } = await admin.from('vehicles').insert({
      transport_company_id: tcId, plate_number: `CP8OFF-${RUN}`, type: 'medium_truck', waste_license_type: 'general',
      ncwm_license_number: `CP8OFF-VEH-${RUN}`, ncwm_license_expiry: '2030-01-01',
    }).select('id').single<{ id: string }>();
    vehicleId = vehicle!.id;
    grandfatherCompliance('vehicle', vehicleId);

    const { data: assignment } = await admin.from('pickup_assignments').insert({
      company_id: companyId, branch_id: branchId, driver_id: driverRecordId, vehicle_id: vehicleId,
      scheduled_at: new Date().toISOString(),
    }).select('id').single<{ id: string }>();
    assignmentId = assignment!.id;

    const { error: signInErr } = await supabase.auth.signInWithPassword({ email, password: PASSWORD });
    if (signInErr) throw new Error(`driver sign-in failed: ${signInErr.message}`);
  });

  afterAll(async () => {
    await supabase.auth.signOut({ scope: 'local' }).catch(() => {});
    await admin.from('pickup_assignments').delete().eq('id', assignmentId);
    await admin.from('pickup_events').delete().eq('logical_id', eventId);
    await admin.from('vehicles').delete().eq('id', vehicleId);
    await admin.from('drivers').delete().eq('id', driverRecordId);
    await admin.from('transport_companies').delete().eq('id', tcId);
    await admin.from('branches').delete().eq('id', branchId);
    await admin.from('companies').delete().eq('id', companyId);
    await admin.from('memberships').delete().eq('user_id', driverUserId);
    await admin.from('profiles').delete().eq('id', driverUserId);
    await admin.auth.admin.deleteUser(driverUserId).catch(() => {});
  });

  it('1. first drain succeeds: creates the ledger row and completes the assignment', async () => {
    const sub: QueuedSubmission = {
      eventId, assignmentId, companyId, branchId, transportCompanyId: tcId,
      driverId: driverRecordId, vehicleId,
      wasteTypes: ['organic'], weightKg: 12,
      qrSkipReason: 'not_applicable_for_stream',
      signatureDataUrl: TINY_PNG_DATA_URL,
      queuedAt: Date.now(), attempts: 0,
    };
    await enqueueSubmission(sub);

    const result = await drainQueue();
    expect(result).toEqual({ synced: 1, failed: 0 });

    const { data: event } = await admin.from('pickup_events').select('id, logical_id').eq('logical_id', eventId).single<{ id: string; logical_id: string }>();
    expect(event).not.toBeNull();

    const { data: assignment } = await admin.from('pickup_assignments').select('status, pickup_event_id').eq('id', assignmentId).single<{ status: string; pickup_event_id: string }>();
    expect(assignment!.status).toBe('completed');
    expect(assignment!.pickup_event_id).toBe(event!.id);
  });

  it('2. re-enqueuing + draining the SAME submission again is idempotent: no duplicate row, same event id', async () => {
    const { data: before } = await admin.from('pickup_events').select('id').eq('logical_id', eventId).single<{ id: string }>();
    const originalEventDbId = before!.id;

    // Simulate: the app crashed/lost connectivity AFTER the first drain
    // actually succeeded server-side, but BEFORE removeQueued() ran locally
    // — the exact scenario the module's replay() logic is designed for.
    const sub: QueuedSubmission = {
      eventId, assignmentId, companyId, branchId, transportCompanyId: tcId,
      driverId: driverRecordId, vehicleId,
      wasteTypes: ['organic'], weightKg: 12,
      qrSkipReason: 'not_applicable_for_stream',
      signatureDataUrl: TINY_PNG_DATA_URL,
      queuedAt: Date.now(), attempts: 0,
    };
    await enqueueSubmission(sub);

    const result = await drainQueue();
    expect(result).toEqual({ synced: 1, failed: 0 });

    const { data: allEvents } = await admin.from('pickup_events').select('id').eq('logical_id', eventId);
    expect(allEvents).toHaveLength(1);
    expect(allEvents![0].id).toBe(originalEventDbId);

    const { data: assignment } = await admin.from('pickup_assignments').select('status, pickup_event_id').eq('id', assignmentId).single<{ status: string; pickup_event_id: string }>();
    expect(assignment!.status).toBe('completed');
    expect(assignment!.pickup_event_id).toBe(originalEventDbId);
  });
});
