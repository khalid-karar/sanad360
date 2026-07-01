/**
 * Driver Assignment → Evidence → Ledger → Completion Flow
 *
 * Integration test for the wired-up driver flow (Weeks 2–3 work): the evidence
 * capture state machine now runs off REAL pickup_assignments instead of seeded
 * fixtures, and completion appends to the immutable ledger with uploaded,
 * hashed evidence before linking the assignment.
 *
 * Mirrors exactly what driverStore.beginPickup()/completePickup() do, as real
 * signed-in users (manager schedules; driver executes). service_role is used
 * only for teardown.
 *
 * Assertions:
 *   1. Driver can read the assignment's branch + company (migration 009)
 *   2. Driver flips the assignment to in_progress
 *   3. Driver uploads evidence into the company prefix (allowed via active
 *      company_transporters link) and appends the pickup event with hashes
 *   4. Server trigger computed geofence + risk on the appended event
 *   5. Assignment is completed and linked to the ledger event
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

// ─── Seed IDs (must match supabase/seed.sql) ─────────────────────────────────
const SEED = {
  companyId:          'a0000000-0000-0000-0000-000000000001',
  branchId:           'b0000000-0000-0000-0000-000000000001',
  transportCompanyId: 'c0000000-0000-0000-0000-000000000001',
  driverId:           'd0000000-0000-0000-0000-000000000001',
  vehicleId:          'e0000000-0000-0000-0000-000000000001',
  managerEmail:       'manager@sanad360.dev',
  managerPassword:    'DevPass1234!',
  driverEmail:        '0501234567@driver.sanad360.com',
  driverPassword:     'DevPass1234!',
};

const RUN = Date.now();

async function sessionClient(email: string, password: string): Promise<SupabaseClient> {
  const { data, error } = await anon.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${data.session!.access_token}` } },
  });
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const buf = new Uint8Array(bytes.byteLength);
  buf.set(bytes);
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

describe('Driver assignment → evidence → ledger → completion', () => {
  let managerClient: SupabaseClient;
  let driverClient: SupabaseClient;
  let assignmentId = '';
  let eventLogicalId = '';
  let eventId = '';
  let photoPath = '';

  beforeAll(async () => {
    [managerClient, driverClient] = await Promise.all([
      sessionClient(SEED.managerEmail, SEED.managerPassword),
      sessionClient(SEED.driverEmail, SEED.driverPassword),
    ]);

    // Manager (dispatch side) schedules the pickup — real RLS insert.
    const { data: a, error } = await managerClient
      .from('pickup_assignments')
      .insert({
        company_id: SEED.companyId,
        branch_id: SEED.branchId,
        driver_id: SEED.driverId,
        vehicle_id: SEED.vehicleId,
        scheduled_at: new Date().toISOString(),
        notes: `driver-flow test ${RUN}`,
      })
      .select('id, status')
      .single<{ id: string; status: string }>();
    if (error || !a) throw new Error(`assignment insert failed: ${error?.message}`);
    assignmentId = a.id;
  });

  afterAll(async () => {
    if (assignmentId) await admin.from('pickup_assignments').delete().eq('id', assignmentId);
    if (eventLogicalId) await admin.from('pickup_events').delete().eq('logical_id', eventLogicalId);
    if (photoPath) await admin.storage.from('pickup-photos').remove([photoPath]);
  });

  it("1. driver can read the assignment's branch and company (migration 009)", async () => {
    const [{ data: branch }, { data: company }] = await Promise.all([
      driverClient.from('branches').select('id, name_ar, company_id').eq('id', SEED.branchId).single(),
      driverClient.from('companies').select('id, name_ar').eq('id', SEED.companyId).single(),
    ]);
    expect(branch).not.toBeNull();
    expect(company).not.toBeNull();
    expect((branch as { company_id: string }).company_id).toBe(SEED.companyId);
  });

  it('2. driver flips the assignment to in_progress', async () => {
    const { data, error } = await driverClient
      .from('pickup_assignments')
      .update({ status: 'in_progress' })
      .eq('id', assignmentId)
      .select('status')
      .single<{ status: string }>();
    expect(error).toBeNull();
    expect(data?.status).toBe('in_progress');
  });

  it('3. driver uploads evidence and appends the pickup event with hashes', async () => {
    eventLogicalId = crypto.randomUUID();
    const photoBytes = new TextEncoder().encode(`driver-flow-photo-${RUN}`);
    const photoSha = await sha256Hex(photoBytes);
    photoPath = `${SEED.companyId}/${SEED.branchId}/${eventLogicalId}/photo.bin`;

    const { error: upErr } = await driverClient.storage
      .from('pickup-photos')
      .upload(photoPath, photoBytes, { upsert: false, contentType: 'application/octet-stream' });
    expect(upErr).toBeNull();

    const { data: event, error: evErr } = await driverClient
      .from('pickup_events')
      .insert({
        logical_id: eventLogicalId,
        revision: 1,
        company_id: SEED.companyId,
        branch_id: SEED.branchId,
        transport_company_id: SEED.transportCompanyId,
        driver_id: SEED.driverId,
        vehicle_id: SEED.vehicleId,
        waste_types: ['organic'],
        weight_kg: 31.5,
        gps_lat: 24.6877,
        gps_lng: 46.6876,
        gps_accuracy_m: 8,
        qr_code_value: `QR-${RUN}`,
        photo_path: photoPath,
        photo_sha256: photoSha,
      })
      .select('id, photo_sha256, geofence_verified, risk_flags, risk_score, created_by')
      .single<{
        id: string;
        photo_sha256: string;
        geofence_verified: boolean;
        risk_flags: string[];
        risk_score: number;
        created_by: string;
      }>();

    expect(evErr).toBeNull();
    expect(event).not.toBeNull();
    eventId = event!.id;
    expect(event!.photo_sha256).toBe(photoSha);
    // 4. Server-side trigger verdicts: inside the seed geofence, and the risk
    //    engine flagged the missing signature (no client input respected).
    expect(event!.geofence_verified).toBe(true);
    expect(event!.risk_flags).toContain('missing_signature');
  });

  it('5. assignment is completed and linked to the ledger event', async () => {
    const { data, error } = await driverClient
      .from('pickup_assignments')
      .update({ status: 'completed', pickup_event_id: eventId })
      .eq('id', assignmentId)
      .select('status, pickup_event_id')
      .single<{ status: string; pickup_event_id: string }>();

    expect(error).toBeNull();
    expect(data?.status).toBe('completed');
    expect(data?.pickup_event_id).toBe(eventId);
  });
});
