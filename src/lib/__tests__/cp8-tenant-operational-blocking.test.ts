/**
 * CP8 D2 (migration 042) — tenant-wide operational blocking.
 *
 * is_owner_operationally_blocked() now covers 'company'/'transport_company'
 * in addition to driver/vehicle: a tenant whose OWN required documents
 * aren't all verified and current is blocked from scheduling new work.
 * Enforced at THREE independent points (not just one — see the migration's
 * Part F header for why a single checkpoint isn't enough):
 *   - pickup_assignments_document_gate() — schedule-time, company AND a
 *     DERIVED transport_company check (pickup_assignments has no
 *     transport_company_id column; resolved via driver_id)
 *   - trips_before_insert() — schedule-time, transport_company (direct
 *     column)
 *   - pickup_events_before_insert() — execution-time, company AND
 *     transport_company; this is the one that closes the real bypass a
 *     direct/ad-hoc pickup_event insert would otherwise have (no FK to
 *     pickup_assignments/trips, trip_id optional)
 *
 * Every fixture here uses service_role directly (bypasses RLS, NOT
 * triggers) — this suite is about the trigger-level gate itself, not RLS.
 * Order-of-checks matters for isolating each assertion cleanly: company is
 * checked before transport_company, which is checked before driver/vehicle
 * — so a fresh (non-exempt) company/transport_company raises its OWN error
 * before ever reaching the driver/vehicle checks, with no need to also
 * grandfather driver/vehicle for the negative cases below.
 *
 * Assertions:
 *   1. A fresh (non-exempt, no required docs) company is blocked from
 *      pickup_assignments (P0026) and from a direct pickup_events insert
 *      (P0026) — proving the execution-time re-check, not just schedule-time
 *   2. A fresh transport_company is blocked from pickup_assignments (P0027,
 *      via the DERIVED driver-lookup), from trips (P0027), and from a
 *      direct pickup_events insert (P0027)
 *   3. A grandfathered tenant (compliance_exempt=true, company +
 *      transport_company + driver + vehicle) is NOT blocked anywhere —
 *      pickup_assignments, trips, and pickup_events all succeed
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { describe, it, expect, afterAll } from 'vitest';
import { grandfatherCompliance } from './testHelpers/complianceExempt';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
if (!SERVICE_KEY) throw new Error('Set SUPABASE_SERVICE_ROLE_KEY in .env.');

const admin: SupabaseClient = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
const RUN = Date.now();

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
    .insert({ name_ar: `شركة ${tag} ${RUN}`, commercial_registration: `CP8-${tag}-${RUN}` })
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
      name_ar: `ناقل ${tag} ${RUN}`,
      commercial_registration: `CP8-TC-${tag}-${RUN}`,
      ncwm_license_number: `NCWM-${tag}-${RUN}`,
      ncwm_license_expiry: '2030-01-01',
    })
    .select('id').single<{ id: string }>();
  const transportCompanyId = tc!.id;

  const { data: driver } = await admin
    .from('drivers')
    .insert({
      transport_company_id: transportCompanyId, name_ar: `سائق ${tag}`,
      license_number: `CP8-DRV-${tag}-${RUN}`, license_expiry: '2030-01-01',
    })
    .select('id').single<{ id: string }>();
  const driverId = driver!.id;

  const { data: vehicle } = await admin
    .from('vehicles')
    .insert({
      transport_company_id: transportCompanyId, plate_number: `CP8-${tag}-${RUN}`,
      type: 'medium_truck', waste_license_type: 'general',
      ncwm_license_number: `CP8-VEH-${tag}-${RUN}`, ncwm_license_expiry: '2030-01-01',
    })
    .select('id').single<{ id: string }>();
  const vehicleId = vehicle!.id;

  return { companyId, branchId, transportCompanyId, driverId, vehicleId };
}

describe('CP8 D2: tenant-wide operational blocking (migration 042)', () => {
  const cleanupCompanyIds: string[] = [];
  const cleanupTcIds: string[] = [];
  const cleanupEventIds: string[] = [];
  const cleanupAssignmentIds: string[] = [];
  const cleanupTripIds: string[] = [];
  const cleanupFacilityIds: string[] = [];

  afterAll(async () => {
    if (cleanupEventIds.length) await admin.from('pickup_events').delete().in('id', cleanupEventIds);
    if (cleanupAssignmentIds.length) await admin.from('pickup_assignments').delete().in('id', cleanupAssignmentIds);
    if (cleanupTripIds.length) await admin.from('trips').delete().in('id', cleanupTripIds);
    if (cleanupFacilityIds.length) await admin.from('facilities').delete().in('id', cleanupFacilityIds);
    if (cleanupTcIds.length) await admin.from('transport_companies').delete().in('id', cleanupTcIds);
    if (cleanupCompanyIds.length) await admin.from('companies').delete().in('id', cleanupCompanyIds);
  });

  it('1. a fresh (non-exempt) company is blocked at pickup_assignments AND at a direct pickup_events insert', async () => {
    const rig = await makeRig('co-block');
    cleanupCompanyIds.push(rig.companyId);
    cleanupTcIds.push(rig.transportCompanyId);
    // Grandfather the transport side only — isolates the assertion to the
    // company check specifically (order: company checked first anyway, but
    // this also proves it's not accidentally the transport_company/driver/
    // vehicle checks doing the blocking).
    grandfatherCompliance('transport_company', rig.transportCompanyId);
    grandfatherCompliance('driver', rig.driverId);
    grandfatherCompliance('vehicle', rig.vehicleId);

    const { error: assignErr } = await admin.from('pickup_assignments').insert({
      company_id: rig.companyId, branch_id: rig.branchId,
      driver_id: rig.driverId, vehicle_id: rig.vehicleId,
      scheduled_at: new Date().toISOString(),
    });
    expect(assignErr).not.toBeNull();
    expect(assignErr!.code).toBe('P0026');
    expect(assignErr!.message).toMatch(/COMPANY_NOT_ACTIVE/);

    const { error: eventErr } = await admin.from('pickup_events').insert({
      logical_id: crypto.randomUUID(), revision: 1,
      company_id: rig.companyId, branch_id: rig.branchId,
      transport_company_id: rig.transportCompanyId,
      driver_id: rig.driverId, vehicle_id: rig.vehicleId,
      waste_types: ['organic'], weight_kg: 10,
    });
    expect(eventErr).not.toBeNull();
    expect(eventErr!.code).toBe('P0026');
    expect(eventErr!.message).toMatch(/COMPANY_NOT_ACTIVE/);
  });

  it('2. a fresh transport_company is blocked at pickup_assignments (derived), trips, AND a direct pickup_events insert', async () => {
    const rig = await makeRig('tc-block');
    cleanupCompanyIds.push(rig.companyId);
    cleanupTcIds.push(rig.transportCompanyId);
    // Grandfather the company side only — isolates to the transport_company check.
    grandfatherCompliance('company', rig.companyId);
    grandfatherCompliance('driver', rig.driverId);
    grandfatherCompliance('vehicle', rig.vehicleId);

    const { error: assignErr } = await admin.from('pickup_assignments').insert({
      company_id: rig.companyId, branch_id: rig.branchId,
      driver_id: rig.driverId, vehicle_id: rig.vehicleId,
      scheduled_at: new Date().toISOString(),
    });
    expect(assignErr).not.toBeNull();
    expect(assignErr!.code).toBe('P0027');
    expect(assignErr!.message).toMatch(/TRANSPORT_COMPANY_NOT_ACTIVE/);

    // A facility this transport_company is actively linked to, required for trips_before_insert.
    const { data: facility } = await admin
      .from('facilities')
      .insert({ name_ar: `منشأة ${RUN}` })
      .select('id').single<{ id: string }>();
    cleanupFacilityIds.push(facility!.id);
    await admin.from('facility_transporters').insert({
      facility_id: facility!.id, transport_company_id: rig.transportCompanyId, status: 'active',
    });

    const { error: tripErr } = await admin.from('trips').insert({
      transport_company_id: rig.transportCompanyId,
      driver_id: rig.driverId, vehicle_id: rig.vehicleId,
      planned_facility_id: facility!.id,
      waste_stream: 'organic', trip_date: new Date().toISOString().slice(0, 10),
    });
    expect(tripErr).not.toBeNull();
    expect(tripErr!.code).toBe('P0027');
    expect(tripErr!.message).toMatch(/TRANSPORT_COMPANY_NOT_ACTIVE/);

    const { error: eventErr } = await admin.from('pickup_events').insert({
      logical_id: crypto.randomUUID(), revision: 1,
      company_id: rig.companyId, branch_id: rig.branchId,
      transport_company_id: rig.transportCompanyId,
      driver_id: rig.driverId, vehicle_id: rig.vehicleId,
      waste_types: ['organic'], weight_kg: 10,
    });
    expect(eventErr).not.toBeNull();
    expect(eventErr!.code).toBe('P0027');
    expect(eventErr!.message).toMatch(/TRANSPORT_COMPANY_NOT_ACTIVE/);
  });

  it('3. a fully grandfathered tenant (company + transport_company + driver + vehicle) is NOT blocked anywhere', async () => {
    const rig = await makeRig('exempt');
    cleanupCompanyIds.push(rig.companyId);
    cleanupTcIds.push(rig.transportCompanyId);
    grandfatherCompliance('company', rig.companyId);
    grandfatherCompliance('transport_company', rig.transportCompanyId);
    grandfatherCompliance('driver', rig.driverId);
    grandfatherCompliance('vehicle', rig.vehicleId);

    const { data: assignment, error: assignErr } = await admin.from('pickup_assignments').insert({
      company_id: rig.companyId, branch_id: rig.branchId,
      driver_id: rig.driverId, vehicle_id: rig.vehicleId,
      scheduled_at: new Date().toISOString(),
    }).select('id').single<{ id: string }>();
    expect(assignErr).toBeNull();
    cleanupAssignmentIds.push(assignment!.id);

    const { data: facility } = await admin
      .from('facilities')
      .insert({ name_ar: `منشأة معفاة ${RUN}` })
      .select('id').single<{ id: string }>();
    cleanupFacilityIds.push(facility!.id);
    await admin.from('facility_transporters').insert({
      facility_id: facility!.id, transport_company_id: rig.transportCompanyId, status: 'active',
    });

    const { data: trip, error: tripErr } = await admin.from('trips').insert({
      transport_company_id: rig.transportCompanyId,
      driver_id: rig.driverId, vehicle_id: rig.vehicleId,
      planned_facility_id: facility!.id,
      waste_stream: 'organic', trip_date: new Date().toISOString().slice(0, 10),
    }).select('id').single<{ id: string }>();
    expect(tripErr).toBeNull();
    cleanupTripIds.push(trip!.id);

    const { data: event, error: eventErr } = await admin.from('pickup_events').insert({
      logical_id: crypto.randomUUID(), revision: 1,
      company_id: rig.companyId, branch_id: rig.branchId,
      transport_company_id: rig.transportCompanyId,
      driver_id: rig.driverId, vehicle_id: rig.vehicleId,
      waste_types: ['organic'], weight_kg: 10,
      // CP3's pickup_events_qr_or_reason_check requires one of qr_code_value/
      // qr_skip_reason — unrelated to this suite's own concern (tenant
      // operational blocking), just satisfying a prerequisite constraint.
      qr_skip_reason: 'not_applicable_for_stream',
    }).select('id').single<{ id: string }>();
    expect(eventErr).toBeNull();
    cleanupEventIds.push(event!.id);
  });
});
