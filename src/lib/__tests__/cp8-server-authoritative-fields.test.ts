/**
 * CP8 Slice H — adversarial: a malicious/buggy client cannot lie about
 * server-computed pickup_events fields.
 *
 * pickup_events grants INSERT to `authenticated` with no column-level
 * restriction (migration 001), so nothing at the RLS/GRANT layer stops a
 * client from including geofence_verified/risk_score/compliance_status/
 * qr_verified in its own INSERT payload. The only thing standing between a
 * forged "I was there, I'm compliant" claim and the ledger is
 * pickup_events_before_insert() unconditionally recomputing every one of
 * these columns from real inputs (gps vs. the branch's real geofence,
 * evidence presence, license expiry, ...) and overwriting whatever NEW
 * already held — never COALESCE-ing with (i.e. never deferring to) the
 * client's own value. Confirmed by reading the live trigger body
 * (`NEW.geofence_verified := (computed)`, `NEW.risk_score := v_score`,
 * `NEW.compliance_status := ...`, all unconditional assignments, no
 * COALESCE anywhere) before writing these — this suite proves that
 * empirically, not just by reading the SQL.
 *
 * Two assertions:
 *   1. A client submits GPS coordinates nowhere near the branch (a
 *      different city) while ALSO forging geofence_verified: true directly
 *      in the insert payload — the stored row's geofence_verified is still
 *      false, and the resulting risk score/flags reflect a real geofence
 *      failure, not the forged claim.
 *   2. A client submits a pickup with every piece of evidence missing (no
 *      photo/signature/gps) while ALSO forging risk_score: 0 and
 *      compliance_status: 'compliant' directly in the insert payload — the
 *      stored row is risk_score > 0 and compliance_status: 'non_compliant',
 *      not the forged claim.
 */

import { createClient } from '@supabase/supabase-js';
import { describe, it, expect } from 'vitest';
import { grandfatherCompliance } from './testHelpers/complianceExempt';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? 'http://localhost:54321';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
if (!SERVICE_KEY) throw new Error('Set SUPABASE_SERVICE_ROLE_KEY in .env before running tests.');

const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

// Seeded branch (supabase/seed.sql): Riyadh Al-Olaya, lat 24.6877 / lng
// 46.6876, radius 150m.
const SEED = {
  companyId: 'a0000000-0000-0000-0000-000000000001',
  branchId: 'b0000000-0000-0000-0000-000000000001',
  transportCompanyId: 'c0000000-0000-0000-0000-000000000001',
  vehicleId: 'e0000000-0000-0000-0000-000000000001',
};

// Jeddah — genuinely nowhere near the Riyadh branch (~950km away), so a
// forged "I was there" claim is unambiguous, not a borderline-radius case.
const FAR_AWAY_LAT = 21.5433;
const FAR_AWAY_LNG = 39.1728;

async function createDriver(): Promise<string> {
  const { data, error } = await admin
    .from('drivers')
    .insert({
      transport_company_id: SEED.transportCompanyId,
      name_ar: 'سائق اختبار الحقول الموثوقة',
      license_number: `CP8SAF-${Date.now()}`,
      license_expiry: '2030-01-01',
      status: 'active',
    })
    .select('id')
    .single<{ id: string }>();
  if (error) throw new Error(`createDriver: ${error.message}`);
  grandfatherCompliance('driver', data.id);
  return data.id;
}

describe('CP8 Slice H: pickup_events server-authoritative fields cannot be forged by the client', () => {
  it('1. a forged geofence_verified:true is overwritten by the real (failing) server-side geofence check', async () => {
    const driverId = await createDriver();
    const { data, error } = await admin
      .from('pickup_events')
      .insert({
        logical_id: crypto.randomUUID(),
        revision: 1,
        company_id: SEED.companyId,
        branch_id: SEED.branchId,
        transport_company_id: SEED.transportCompanyId,
        driver_id: driverId,
        vehicle_id: SEED.vehicleId,
        waste_types: ['organic'],
        weight_kg: 10,
        gps_lat: FAR_AWAY_LAT,
        gps_lng: FAR_AWAY_LNG,
        gps_accuracy_m: 5,
        // The forgery: claiming true directly in the insert payload.
        geofence_verified: true,
        qr_skip_reason: 'not_applicable_for_stream',
      })
      .select('geofence_verified, risk_flags, risk_score')
      .single<{ geofence_verified: boolean; risk_flags: string[]; risk_score: number }>();

    expect(error).toBeNull();
    expect(data!.geofence_verified).toBe(false);
    expect(data!.risk_flags).toContain('geofence_failed');
    expect(data!.risk_score).toBeGreaterThan(0);

    await admin.from('pickup_events').delete().eq('driver_id', driverId);
    await admin.from('drivers').delete().eq('id', driverId);
  });

  it("2. a forged risk_score:0 + compliance_status:'compliant' is overwritten by the real (non-compliant) server-side computation", async () => {
    const driverId = await createDriver();
    const { data, error } = await admin
      .from('pickup_events')
      .insert({
        logical_id: crypto.randomUUID(),
        revision: 1,
        company_id: SEED.companyId,
        branch_id: SEED.branchId,
        transport_company_id: SEED.transportCompanyId,
        driver_id: driverId,
        vehicle_id: SEED.vehicleId,
        waste_types: ['organic'],
        weight_kg: 10,
        // No gps, no photo, no signature — every piece of default-required
        // evidence (qr/geofenced_gps/photo/signature) is genuinely missing.
        qr_skip_reason: 'not_applicable_for_stream',
        // The forgery: claiming a clean bill of health directly in the payload.
        risk_score: 0,
        compliance_status: 'compliant',
        risk_flags: [],
      })
      .select('risk_score, compliance_status, risk_flags')
      .single<{ risk_score: number; compliance_status: string; risk_flags: string[] }>();

    expect(error).toBeNull();
    expect(data!.risk_score).toBeGreaterThan(0);
    expect(data!.compliance_status).toBe('non_compliant');
    expect(data!.risk_flags).toContain('missing_photo');
    expect(data!.risk_flags).toContain('missing_signature');
    expect(data!.risk_flags).toContain('missing_required_evidence');

    await admin.from('pickup_events').delete().eq('driver_id', driverId);
    await admin.from('drivers').delete().eq('id', driverId);
  });
});
