/**
 * Flagged-Records Review Queue
 *
 * Exercises the data contract behind src/lib/api/review.ts as a REAL signed-in
 * company manager: flagged events (risk engine) and open custody chains
 * surface for review; fully-compliant + custody-closed events carry no
 * reasons; acknowledgement is company-scoped and idempotent at the DB layer.
 *
 * Assertions:
 *   1. Event with missing photo + no disposal confirmation → manager sees the
 *      risk flag AND the open custody chain
 *   2. Fully compliant event WITH confirmation → zero risk flags, custody closed
 *   3. Manager can acknowledge (alert_acknowledgements) and re-read it;
 *      duplicate acknowledgement hits the UNIQUE constraint (23505)
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

const SEED = {
  companyId:          'a0000000-0000-0000-0000-000000000001',
  branchId:           'b0000000-0000-0000-0000-000000000001',
  transportCompanyId: 'c0000000-0000-0000-0000-000000000001',
  vehicleId:          'e0000000-0000-0000-0000-000000000001',
  managerEmail:       'manager@sanad360.dev',
  managerProfileId:   'f0000000-0000-0000-0000-000000000001',
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

function farFuture(): string {
  const d = new Date();
  d.setDate(d.getDate() + 90);
  return d.toISOString().substring(0, 10);
}

describe('Review queue data contract', () => {
  let manager: SupabaseClient;
  let cleanDriverId = '';
  let cleanVehicleId = '';
  let flaggedEventId = '';
  let compliantEventId = '';
  let confirmationId = '';
  let ackId = '';
  let branchQrToken = '';

  beforeAll(async () => {
    manager = await sessionClient(SEED.managerEmail);

    // Fresh driver/vehicle with far-future licenses so no expiry flags fire.
    const { data: d } = await admin
      .from('drivers')
      .insert({
        transport_company_id: SEED.transportCompanyId,
        name_ar: 'سائق مراجعة',
        license_number: `RQ-${RUN}`,
        license_expiry: farFuture(),
      })
      .select('id')
      .single<{ id: string }>();
    cleanDriverId = d!.id;

    const { data: v } = await admin
      .from('vehicles')
      .insert({
        transport_company_id: SEED.transportCompanyId,
        plate_number: `RQ-${RUN}`,
        type: 'medium_truck',
        waste_license_type: 'general',
        ncwm_license_expiry: farFuture(),
      })
      .select('id')
      .single<{ id: string }>();
    cleanVehicleId = v!.id;

    const { data: branch } = await admin
      .from('branches')
      .select('qr_token')
      .eq('id', SEED.branchId)
      .single<{ qr_token: string }>();
    branchQrToken = branch!.qr_token;

    // Flagged: no photo, no confirmation.
    const { data: fe } = await admin
      .from('pickup_events')
      .insert({
        logical_id: crypto.randomUUID(),
        revision: 1,
        company_id: SEED.companyId,
        branch_id: SEED.branchId,
        transport_company_id: SEED.transportCompanyId,
        driver_id: cleanDriverId,
        vehicle_id: cleanVehicleId,
        waste_types: ['organic'],
        weight_kg: 20,
        gps_lat: 24.6877,
        gps_lng: 46.6876,
        gps_accuracy_m: 10,
        signature_path: 'rq/sig.png',
      })
      .select('id')
      .single<{ id: string }>();
    flaggedEventId = fe!.id;

    // Fully compliant + confirmed custody.
    const { data: ce } = await admin
      .from('pickup_events')
      .insert({
        logical_id: crypto.randomUUID(),
        revision: 1,
        company_id: SEED.companyId,
        branch_id: SEED.branchId,
        transport_company_id: SEED.transportCompanyId,
        driver_id: cleanDriverId,
        vehicle_id: cleanVehicleId,
        waste_types: ['organic'],
        weight_kg: 20,
        gps_lat: 24.6877,
        gps_lng: 46.6876,
        gps_accuracy_m: 10,
        qr_code_value: branchQrToken,
        photo_path: 'rq/photo.jpg',
        signature_path: 'rq/sig.png',
      })
      .select('id')
      .single<{ id: string }>();
    compliantEventId = ce!.id;

    const { data: conf } = await admin
      .from('disposal_confirmations')
      .insert({ pickup_event_id: compliantEventId, facility_name_ar: 'منشأة مراجعة' })
      .select('id')
      .single<{ id: string }>();
    confirmationId = conf!.id;
  });

  afterAll(async () => {
    if (ackId) await admin.from('alert_acknowledgements').delete().eq('id', ackId);
    if (confirmationId) await admin.from('disposal_confirmations').delete().eq('id', confirmationId);
    if (flaggedEventId) await admin.from('pickup_events').delete().eq('id', flaggedEventId);
    if (compliantEventId) await admin.from('pickup_events').delete().eq('id', compliantEventId);
    if (cleanDriverId) await admin.from('drivers').delete().eq('id', cleanDriverId);
    if (cleanVehicleId) await admin.from('vehicles').delete().eq('id', cleanVehicleId);
  });

  it('1. flagged event surfaces with risk flag + open custody chain', async () => {
    const { data: event, error } = await manager
      .from('pickup_events_latest')
      .select('id, risk_flags')
      .eq('id', flaggedEventId)
      .single<{ id: string; risk_flags: string[] }>();
    expect(error).toBeNull();
    expect(event!.risk_flags).toContain('missing_photo');

    const { data: confs } = await manager
      .from('disposal_confirmations')
      .select('pickup_event_id')
      .eq('pickup_event_id', flaggedEventId);
    expect(confs ?? []).toHaveLength(0); // custody chain open → needs review
  });

  it('2. compliant + custody-closed event carries no review reasons', async () => {
    const { data: event } = await manager
      .from('pickup_events_latest')
      .select('id, risk_flags, risk_score, compliance_status')
      .eq('id', compliantEventId)
      .single<{ id: string; risk_flags: string[]; risk_score: number; compliance_status: string }>();
    expect(event!.risk_flags).toHaveLength(0);
    expect(event!.risk_score).toBe(0);
    expect(event!.compliance_status).toBe('compliant');

    const { data: confs } = await manager
      .from('disposal_confirmations')
      .select('pickup_event_id')
      .eq('pickup_event_id', compliantEventId);
    expect(confs).toHaveLength(1); // custody chain closed
  });

  it('3. manager can acknowledge a review; duplicate hits UNIQUE (idempotency)', async () => {
    const alertKey = `pickup_review:${flaggedEventId}`;
    const { data: ack, error } = await manager
      .from('alert_acknowledgements')
      .insert({
        company_id: SEED.companyId,
        alert_key: alertKey,
        acknowledged_by: SEED.managerProfileId,
      })
      .select('id')
      .single<{ id: string }>();
    expect(error).toBeNull();
    ackId = ack!.id;

    // Readable back through RLS.
    const { data: readBack } = await manager
      .from('alert_acknowledgements')
      .select('alert_key')
      .eq('alert_key', alertKey);
    expect(readBack).toHaveLength(1);

    // Duplicate acknowledgement → 23505 (the API treats it as success).
    const { error: dupErr } = await manager
      .from('alert_acknowledgements')
      .insert({ company_id: SEED.companyId, alert_key: alertKey });
    expect(dupErr?.code).toBe('23505');
  });
});
