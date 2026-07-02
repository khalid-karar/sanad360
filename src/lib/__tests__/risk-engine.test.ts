/**
 * Risk Engine Integration Tests
 *
 * Verifies that the pickup_events_before_insert() trigger in migration 002
 * correctly computes risk_score, risk_flags, and compliance_status.
 *
 * Requires a running Supabase instance with migrations 001 + 002 applied:
 *   supabase start && supabase db reset
 *
 * Uses service_role to insert test drivers/vehicles with specific expiry dates,
 * inserts pickup_events, reads the trigger-computed fields, then cleans up.
 *
 * Eight assertions:
 *   1. missing_photo flag fires (+25) when photo_path IS NULL
 *   2. missing_signature flag fires (+25) when signature_path IS NULL
 *   3. geofence_failed flag fires (+20) when GPS is null (fail-closed)
 *   4. driver_license_expiring flag fires (+15) when license already expired
 *   5. vehicle_license_expiring flag fires (+15) when ncwm_license_expiry already expired
 *   6. All five flags fire → score = 100 (exact sum, proves cap is correct)
 *   7. Compliance threshold: score in [1,39] → 'warning'
 *   8. Compliance threshold: score = 0 → 'compliant'
 */

import { createClient } from '@supabase/supabase-js';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

// ─── Client setup ────────────────────────────────────────────────────────────

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? 'http://localhost:54321';
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

if (!SERVICE_KEY) {
  throw new Error('Set SUPABASE_SERVICE_ROLE_KEY in .env before running tests.');
}

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
});

// ─── Seed constants (must match supabase/seed.sql) ───────────────────────────
const SEED = {
  companyId:          'a0000000-0000-0000-0000-000000000001',
  branchId:           'b0000000-0000-0000-0000-000000000001',
  transportCompanyId: 'c0000000-0000-0000-0000-000000000001',
  vehicleId:          'e0000000-0000-0000-0000-000000000001', // ncwm_license_expiry far future
};

// IDs created by tests — collected for cleanup
const cleanupEventIds: string[]   = [];
const cleanupDriverIds: string[]  = [];
const cleanupVehicleIds: string[] = [];

// ─── Helpers ─────────────────────────────────────────────────────────────────

// Yesterday's date in YYYY-MM-DD (guaranteed expired)
function yesterday(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().substring(0, 10);
}

// 60 days in the future (outside the 30-day warning window → no flag)
function farFuture(): string {
  const d = new Date();
  d.setDate(d.getDate() + 60);
  return d.toISOString().substring(0, 10);
}

async function createTestDriver(licenseExpiry: string): Promise<string> {
  const { data, error } = await admin
    .from('drivers')
    .insert({
      transport_company_id: SEED.transportCompanyId,
      name_ar: 'سائق تجريبي',
      license_number: `TEST-${Date.now()}`,
      license_expiry: licenseExpiry,
      status: 'active',
    })
    .select('id')
    .single<{ id: string }>();
  if (error) throw new Error(`createTestDriver: ${error.message}`);
  cleanupDriverIds.push(data.id);
  return data.id;
}

async function createTestVehicle(ncwmExpiry: string): Promise<string> {
  const { data, error } = await admin
    .from('vehicles')
    .insert({
      transport_company_id: SEED.transportCompanyId,
      plate_number: `TEST-${Date.now()}`,
      type: 'medium_truck',
      waste_license_type: 'general',
      ncwm_license_expiry: ncwmExpiry,
      status: 'active',
    })
    .select('id')
    .single<{ id: string }>();
  if (error) throw new Error(`createTestVehicle: ${error.message}`);
  cleanupVehicleIds.push(data.id);
  return data.id;
}

interface InsertResult {
  id: string;
  risk_score: number;
  risk_flags: string[];
  compliance_status: string;
}

async function insertPickup(opts: {
  driverId: string;
  vehicleId: string;
  photoPath?: string | null;
  signaturePath?: string | null;
  gpsLat?: number | null;
  gpsLng?: number | null;
  gpsAccuracyM?: number | null;
}): Promise<InsertResult> {
  const { data, error } = await admin
    .from('pickup_events')
    .insert({
      logical_id:           crypto.randomUUID(),
      revision:             1,
      company_id:           SEED.companyId,
      branch_id:            SEED.branchId,
      transport_company_id: SEED.transportCompanyId,
      driver_id:            opts.driverId,
      vehicle_id:           opts.vehicleId,
      waste_types:          ['organic'],
      weight_kg:            10,
      // Use !== undefined so explicit null is forwarded as null (not replaced by the default)
      gps_lat:         opts.gpsLat         !== undefined ? opts.gpsLat         : 24.6877,
      gps_lng:         opts.gpsLng         !== undefined ? opts.gpsLng         : 46.6876,
      // Migration 013: geofence requires credible accuracy; default to a good fix
      gps_accuracy_m:  opts.gpsAccuracyM   !== undefined ? opts.gpsAccuracyM   : 10,
      photo_path:      opts.photoPath      !== undefined ? opts.photoPath      : 'company/branch/event/photo.jpg',
      signature_path:  opts.signaturePath  !== undefined ? opts.signaturePath  : 'company/branch/event/signature.png',
    })
    .select('id, risk_score, risk_flags, compliance_status')
    .single<InsertResult>();

  if (error) throw new Error(`insertPickup: ${error.message}`);
  cleanupEventIds.push(data.id);
  return data;
}

// ─── Lifecycle ───────────────────────────────────────────────────────────────

beforeAll(async () => {
  const { data } = await admin.from('companies').select('id').eq('id', SEED.companyId).single();
  if (!data) {
    throw new Error(
      'Seed data not found. Run `supabase db reset` (applies 001 + 002 + seed), then retry.'
    );
  }
});

afterAll(async () => {
  if (cleanupEventIds.length > 0) {
    await admin.from('pickup_events').delete().in('id', cleanupEventIds);
  }
  if (cleanupDriverIds.length > 0) {
    await admin.from('drivers').delete().in('id', cleanupDriverIds);
  }
  if (cleanupVehicleIds.length > 0) {
    await admin.from('vehicles').delete().in('id', cleanupVehicleIds);
  }
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Risk engine — pickup_events_before_insert()', () => {

  it('1. missing_photo fires (+25) when photo_path IS NULL', async () => {
    const driverId  = await createTestDriver(farFuture());
    const vehicleId = await createTestVehicle(farFuture());

    const result = await insertPickup({
      driverId, vehicleId,
      photoPath: null,          // ← triggers the flag
      signaturePath: 'path/sig.png',
    });

    expect(result.risk_flags).toContain('missing_photo');
    expect(result.risk_score).toBeGreaterThanOrEqual(25);
  });

  it('2. missing_signature fires (+25) when signature_path IS NULL', async () => {
    const driverId  = await createTestDriver(farFuture());
    const vehicleId = await createTestVehicle(farFuture());

    const result = await insertPickup({
      driverId, vehicleId,
      photoPath: 'path/photo.jpg',
      signaturePath: null,       // ← triggers the flag
    });

    expect(result.risk_flags).toContain('missing_signature');
    expect(result.risk_score).toBeGreaterThanOrEqual(25);
  });

  it('3. geofence_failed fires (+20) when GPS is null (fail-closed)', async () => {
    const driverId  = await createTestDriver(farFuture());
    const vehicleId = await createTestVehicle(farFuture());

    const result = await insertPickup({
      driverId, vehicleId,
      gpsLat: null,
      gpsLng: null,
    });

    expect(result.risk_flags).toContain('geofence_failed');
    expect(result.risk_score).toBeGreaterThanOrEqual(20);
  });

  it('4. driver_license_expiring fires (+15) when license already expired', async () => {
    const driverId  = await createTestDriver(yesterday());   // ← expired yesterday
    const vehicleId = await createTestVehicle(farFuture());

    const result = await insertPickup({ driverId, vehicleId });

    expect(result.risk_flags).toContain('driver_license_expiring');
    expect(result.risk_score).toBeGreaterThanOrEqual(15);
  });

  it('5. vehicle_license_expiring fires (+15) when ncwm_license_expiry already expired', async () => {
    const driverId  = await createTestDriver(farFuture());
    const vehicleId = await createTestVehicle(yesterday());  // ← expired yesterday

    const result = await insertPickup({ driverId, vehicleId });

    expect(result.risk_flags).toContain('vehicle_license_expiring');
    expect(result.risk_score).toBeGreaterThanOrEqual(15);
  });

  it('6. All five flags fire: score = 100 (25+25+20+15+15)', async () => {
    const driverId  = await createTestDriver(yesterday());
    const vehicleId = await createTestVehicle(yesterday());

    const result = await insertPickup({
      driverId, vehicleId,
      photoPath: null,
      signaturePath: null,
      gpsLat: null,
      gpsLng: null,
    });

    expect(result.risk_flags).toHaveLength(5);
    expect(result.risk_flags).toContain('missing_photo');
    expect(result.risk_flags).toContain('missing_signature');
    expect(result.risk_flags).toContain('geofence_failed');
    expect(result.risk_flags).toContain('driver_license_expiring');
    expect(result.risk_flags).toContain('vehicle_license_expiring');
    // 25+25+20+15+15 = 100, exactly at the cap
    expect(result.risk_score).toBe(100);
    expect(result.compliance_status).toBe('non_compliant');
  });

  it('7. Score in [1, 39] → compliance_status = warning', async () => {
    // Only driver_license_expiring fires (15 points) → score=15, status='warning'
    const driverId  = await createTestDriver(yesterday());
    const vehicleId = await createTestVehicle(farFuture());

    const result = await insertPickup({ driverId, vehicleId });

    expect(result.risk_score).toBe(15);
    expect(result.compliance_status).toBe('warning');
  });

  it('8. Score = 0 → compliance_status = compliant', async () => {
    // Good driver + good vehicle + GPS present + photo + signature → all clear
    const driverId  = await createTestDriver(farFuture());
    const vehicleId = await createTestVehicle(farFuture());

    const result = await insertPickup({
      driverId, vehicleId,
      photoPath:     'company/branch/event/photo.jpg',
      signaturePath: 'company/branch/event/signature.png',
      gpsLat:        24.6877,
      gpsLng:        46.6876,
    });

    expect(result.risk_score).toBe(0);
    expect(result.risk_flags).toHaveLength(0);
    expect(result.compliance_status).toBe('compliant');
  });
});
