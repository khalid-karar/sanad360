/**
 * pending_confirmation PDF generation + admin sweep endpoint
 * (Migration 030, CP5 review item 1a/2)
 *
 * Skips automatically if the PDF service isn't reachable (same pattern as
 * phase2-acceptance.test.ts). The actual "renders distinctly, never
 * compliant" content assertion lives at the HTML-template level instead
 * (services/pdf/src/templates/pending-confirmation-reporting.test.ts) —
 * pdf-parse reorders/reshapes Arabic glyphs on extraction from a real
 * rendered PDF, which the rest of this suite already works around by never
 * asserting literal Arabic phrases from extracted text (see
 * phase2-acceptance.test.ts's "MANUAL CHECK required" comments). This file
 * proves the END-TO-END route: a pending pickup generates successfully and
 * the resulting PDF is well-formed (magic bytes), plus the admin sweep
 * endpoint's auth model.
 *
 * Assertions:
 *   1. A pending pickup's inspection PDF generates successfully (200,
 *      valid PDF bytes) end-to-end through the real route (which now also
 *      fetches pickup_confirmations — this proves that fetch doesn't break
 *      generation for a pickup with none yet)
 *   2. POST /admin/sweep-expired-confirmations: service_role key succeeds;
 *      a plain authenticated (non-admin) caller is rejected with 403.
 */

import { createClient } from '@supabase/supabase-js';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { grandfatherCompliance } from './testHelpers/complianceExempt';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY ?? '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const PDF_SERVICE_URL = process.env.VITE_PDF_SERVICE_URL ?? 'http://localhost:3001';

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

async function isPdfServiceUp(): Promise<boolean> {
  try {
    const res = await fetch(`${PDF_SERVICE_URL}/health`, { signal: AbortSignal.timeout(3_000) });
    return res.ok;
  } catch {
    return false;
  }
}

describe('pending_confirmation in the inspection PDF + admin sweep endpoint (Migration 030)', () => {
  let serviceUp = false;
  let evidenceReqId = '';
  let managerJwt = '';
  let driverJwt = '';
  // Dedicated, throwaway transport company (+ driver + vehicle) — NOT
  // SEED.transportCompanyId, which every other test file's fixtures also
  // use by default. evidence_requirements is scoped per transport_company_id,
  // so requiring branch_confirmation on the shared default would leak into
  // every other suite running concurrently.
  let dedicatedTcId = '';
  let dedicatedDriverId = '';
  let dedicatedVehicleId = '';
  const cleanupEventIds: string[] = [];

  beforeAll(async () => {
    serviceUp = await isPdfServiceUp();
    if (!serviceUp) return;

    const { data: tc } = await admin
      .from('transport_companies')
      .insert({
        name_ar: `شركة نقل معزولة (PDF) ${RUN}`,
        commercial_registration: `PENDPDF-${RUN}`,
        ncwm_license_number: `NCWM-PENDPDF-${RUN}`,
        ncwm_license_expiry: '2030-01-01',
      })
      .select('id')
      .single<{ id: string }>();
    dedicatedTcId = tc!.id;

    const { data: drv } = await admin
      .from('drivers')
      .insert({
        transport_company_id: dedicatedTcId,
        name_ar: 'سائق اختبار PDF',
        license_number: `PENDPDF-DRV-${RUN}`,
        license_expiry: '2030-01-01',
      })
      .select('id')
      .single<{ id: string }>();
    dedicatedDriverId = drv!.id;
    grandfatherCompliance('driver', dedicatedDriverId);

    const { data: veh } = await admin
      .from('vehicles')
      .insert({
        transport_company_id: dedicatedTcId,
        plate_number: `PENDPDF-${RUN}`,
        type: 'medium_truck',
        waste_license_type: 'general',
        ncwm_license_number: `PENDPDF-VEH-${RUN}`,
        ncwm_license_expiry: '2030-01-01',
      })
      .select('id')
      .single<{ id: string }>();
    dedicatedVehicleId = veh!.id;
    grandfatherCompliance('vehicle', dedicatedVehicleId);

    const { data: req } = await admin
      .from('evidence_requirements')
      .insert({
        waste_stream: '*',
        transport_company_id: dedicatedTcId,
        required_items: ['geofenced_gps', 'photo', 'signature', 'branch_confirmation'],
      })
      .select('id')
      .single<{ id: string }>();
    evidenceReqId = req!.id;

    const [{ data: mgrSignIn }, { data: drvSignIn }] = await Promise.all([
      anon.auth.signInWithPassword({ email: SEED.managerEmail, password: SEED.password }),
      anon.auth.signInWithPassword({ email: SEED.driverEmail, password: SEED.password }),
    ]);
    managerJwt = mgrSignIn!.session!.access_token;
    driverJwt = drvSignIn!.session!.access_token;
  });

  afterAll(async () => {
    if (cleanupEventIds.length) await admin.from('pickup_events').delete().in('id', cleanupEventIds);
    if (evidenceReqId) await admin.from('evidence_requirements').delete().eq('id', evidenceReqId);
    if (dedicatedVehicleId) await admin.from('vehicles').delete().eq('id', dedicatedVehicleId);
    if (dedicatedDriverId) await admin.from('drivers').delete().eq('id', dedicatedDriverId);
    if (dedicatedTcId) await admin.from('transport_companies').delete().eq('id', dedicatedTcId);
  });

  it('1. a pending pickup generates a valid inspection PDF end-to-end (route now also fetches pickup_confirmations)', async () => {
    if (!serviceUp) { console.log('SKIP: PDF service not running'); return; }

    const { data: event, error } = await admin
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
        weight_kg: 15,
        gps_lat: 24.6877,
        gps_lng: 46.6876,
        gps_accuracy_m: 10,
        photo_path: 'p/photo.jpg',
        signature_path: 'p/sig.png',
        qr_skip_reason: 'not_applicable_for_stream',
      })
      .select('id, compliance_status')
      .single<{ id: string; compliance_status: string }>();
    expect(error).toBeNull();
    cleanupEventIds.push(event!.id);
    expect(event!.compliance_status).toBe('pending_confirmation');

    const res = await fetch(`${PDF_SERVICE_URL}/generate/single-pickup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${managerJwt}` },
      body: JSON.stringify({ pickup_event_id: event!.id }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { signed_url: string; inspection_pdf_id: string };

    const pdfRes = await fetch(body.signed_url);
    const pdfBytes = new Uint8Array(await pdfRes.arrayBuffer());
    // %PDF magic bytes — proves the branchConfirmation fetch/threading
    // didn't break rendering for the (common) no-confirmation-yet case.
    expect(Buffer.from(pdfBytes.slice(0, 4)).toString('ascii')).toBe('%PDF');

    await admin.from('inspection_pdfs').delete().eq('id', body.inspection_pdf_id);
  });

  it('2. sweep endpoint: service_role key succeeds, plain authenticated caller is rejected', async () => {
    if (!serviceUp) { console.log('SKIP: PDF service not running'); return; }

    const okRes = await fetch(`${PDF_SERVICE_URL}/admin/sweep-expired-confirmations`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${SERVICE_KEY}` },
    });
    expect(okRes.status).toBe(200);
    const okBody = (await okRes.json()) as { recomputed: number };
    expect(typeof okBody.recomputed).toBe('number');

    const deniedRes = await fetch(`${PDF_SERVICE_URL}/admin/sweep-expired-confirmations`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${driverJwt}` },
    });
    expect(deniedRes.status).toBe(403);
  });
});
