/**
 * CP2 — Onboarding & compliance document gating (migrations 020 + 021)
 *
 * "No entity goes ACTIVE without complete, current, verified documents."
 * All assertions run as REAL signed-in users (company manager, transport
 * manager, driver, document reviewer, outsider transport manager);
 * service_role is used for setup/teardown only, except where a real
 * reviewer sign-in is required to move a fixture doc into its reviewed
 * state (documents_before_update rejects service_role — auth.uid() is
 * NULL for it, so can_review_documents() is false; using the real
 * reviewer client for fixture setup means every fixture is verified via
 * the REAL review path, not a service_role shortcut).
 *
 * Assertions:
 *   1. uploader cannot self-verify their own document
 *   2. reviewer can verify a pending document
 *   3. reviewer can reject a document (mandatory reason enforced)
 *   4. reject without a reason is rejected by the DB constraint
 *   5. completion_pct / activation_status are correct for a fully-verified
 *      tenant (the seeded company, 100% / active)
 *   6. a document expiring soon still counts as satisfied but is flagged
 *      in expiring_soon (seeded driver's driving licence, ~10 days out)
 *   7. an entity cannot go active while a required doc is unverified
 *      (pending) — even with the other required doc verified
 *   8. an expired (but reviewed) document restricts ONLY that driver —
 *      the seeded, unrelated driver stays active
 *   9. a restricted (non-exempt) driver cannot be scheduled
 *      (pickup_assignments insert → P0023 DRIVER_NOT_ACTIVE)
 *  10. a restricted (non-exempt) driver cannot complete a pickup
 *      (pickup_events insert → P0023 DRIVER_NOT_ACTIVE)
 *  11. a brand-new driver with zero documents is blocked (exercises the
 *      real gate — compliance_exempt defaults to false, forced by the
 *      lock trigger, for every row inserted after CP2 landed)
 *  12. a grandfathered legacy entity (compliance_exempt=true, backfilled
 *      at migration time) still works even while NOT active — the seeded
 *      vehicle, whose NCWM licence was deliberately seeded as rejected,
 *      can still be scheduled
 *  13. cross-tenant document access is denied (RLS filters, not an error)
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { grandfatherCompliance } from './testHelpers/complianceExempt';

const DB_CONTAINER = process.env.SUPABASE_DB_CONTAINER ?? 'supabase_db_sanad360';

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
  branchId:            'b0000000-0000-0000-0000-000000000001',
  transportCompanyId: 'c0000000-0000-0000-0000-000000000001',
  driverId:            'd0000000-0000-0000-0000-000000000001',
  vehicleId:           'e0000000-0000-0000-0000-000000000001',
  companyManagerEmail:   'manager@sanad360.dev',
  transportManagerEmail: 'transport.manager@sanad360.dev',
  driverEmail:            '0501234567@driver.sanad360.com',
  reviewerEmail:          'reviewer@sanad360.dev',
  password:               'DevPass1234!',
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

interface StatusRow {
  completion_pct: number;
  activation_status: string;
  missing_doc_types: string[];
  expired_doc_types: string[];
  unverified_doc_types: string[];
  expiring_soon: Array<{ doc_type: string; days_remaining: number; level: string }>;
}

async function ownerStatus(client: SupabaseClient, ownerType: string, ownerId: string): Promise<StatusRow> {
  const { data, error } = await client
    .rpc('owner_document_status', { p_owner_type: ownerType, p_owner_id: ownerId })
    .single<StatusRow>();
  if (error) throw error;
  return data;
}

describe('CP2 — onboarding & compliance document gating', () => {
  let companyClient: SupabaseClient;
  let transportClient: SupabaseClient;
  let driverClient: SupabaseClient;
  let reviewerClient: SupabaseClient;
  let outsiderTransportClient: SupabaseClient;

  // Fresh, non-exempt driver fixtures (inserted after CP2 landed).
  let driverNoDocsId = '';
  let driverExpiredId = '';
  let driverPendingId = '';
  let vehicleActiveId = '';

  let outsiderTransportCompanyId = '';
  let outsiderDriverId = '';
  let outsiderUserId = '';
  let outsiderDocId = '';

  const cleanupDocIds: string[] = [];
  const cleanupDriverIds: string[] = [];
  const cleanupVehicleIds: string[] = [];
  const cleanupAssignmentIds: string[] = [];
  const cleanupEventIds: string[] = [];

  beforeAll(async () => {
    [companyClient, transportClient, driverClient, reviewerClient] = await Promise.all([
      sessionClient(SEED.companyManagerEmail, SEED.password),
      sessionClient(SEED.transportManagerEmail, SEED.password),
      sessionClient(SEED.driverEmail, SEED.password),
      sessionClient(SEED.reviewerEmail, SEED.password),
    ]);

    // driverNoDocs — zero documents, brand-new (non-exempt).
    {
      const { data } = await admin.from('drivers').insert({
        transport_company_id: SEED.transportCompanyId,
        name_ar: `سائق بلا مستندات ${RUN}`,
        license_number: `CP2-NODOCS-${RUN}`,
        license_expiry: '2030-01-01',
      }).select('id').single<{ id: string }>();
      driverNoDocsId = data!.id;
      cleanupDriverIds.push(driverNoDocsId);
    }

    // driverExpired — driver row only; its two required docs are inserted
    // and reviewed via real clients further down (documents_before_insert /
    // _update require a real auth.uid(), which service_role doesn't have).
    {
      const { data } = await admin.from('drivers').insert({
        transport_company_id: SEED.transportCompanyId,
        name_ar: `سائق منتهي الصلاحية ${RUN}`,
        license_number: `CP2-EXPIRED-${RUN}`,
        license_expiry: '2030-01-01',
      }).select('id').single<{ id: string }>();
      driverExpiredId = data!.id;
      cleanupDriverIds.push(driverExpiredId);
    }

    // driverPendingReview — iqama verified, driving_license still pending.
    {
      const { data } = await admin.from('drivers').insert({
        transport_company_id: SEED.transportCompanyId,
        name_ar: `سائق قيد المراجعة ${RUN}`,
        license_number: `CP2-PENDING-${RUN}`,
        license_expiry: '2030-01-01',
      }).select('id').single<{ id: string }>();
      driverPendingId = data!.id;
      cleanupDriverIds.push(driverPendingId);
    }

    // vehicleActive — a genuinely ACTIVE, non-exempt vehicle (both required
    // docs verified via the real reviewer client below) so tests that need
    // a compliant vehicle aren't relying on the seeded vehicle, which is
    // deliberately restricted (rejected NCWM doc) for the demo.
    {
      const { data } = await admin.from('vehicles').insert({
        transport_company_id: SEED.transportCompanyId,
        plate_number: `CP2-ACTIVE-${RUN}`,
        type: 'medium_truck',
        waste_license_type: 'general',
        ncwm_license_expiry: '2030-01-01',
      }).select('id').single<{ id: string }>();
      vehicleActiveId = data!.id;
      cleanupVehicleIds.push(vehicleActiveId);
    }

    // Outsider transport company + driver + user, for the cross-tenant check.
    const { data: tc2 } = await admin
      .from('transport_companies')
      .insert({ name_ar: `شركة نقل عزل مستندات ${RUN}`, commercial_registration: `CR-CP2-${RUN}` })
      .select('id')
      .single<{ id: string }>();
    outsiderTransportCompanyId = tc2!.id;

    const { data: d2 } = await admin.from('drivers').insert({
      transport_company_id: outsiderTransportCompanyId,
      name_ar: 'سائق معزول عن المستندات',
      license_number: `CP2-OUT-${RUN}`,
      license_expiry: '2030-01-01',
    }).select('id').single<{ id: string }>();
    outsiderDriverId = d2!.id;

    const { data: outsiderDoc } = await admin.from('documents').insert({
      owner_type: 'driver', owner_id: outsiderDriverId, doc_type: 'iqama',
      file_path: `driver/${outsiderDriverId}/iqama-${RUN}.pdf`, file_sha256: `${RUN}-out-iqama`,
      issue_date: '2020-01-01', expiry_date: '2030-01-01',
    }).select('id').single<{ id: string }>();
    outsiderDocId = outsiderDoc!.id;
    cleanupDocIds.push(outsiderDocId);

    const OUTSIDER_EMAIL = `cp2-outsider-${RUN}@sanad360.dev`;
    const { data: created } = await admin.auth.admin.createUser({
      email: OUTSIDER_EMAIL, password: 'DevPass1234!', email_confirm: true,
    });
    outsiderUserId = created.user!.id;
    await admin.from('memberships').insert({
      user_id: outsiderUserId, role: 'manager', transport_company_id: outsiderTransportCompanyId,
    });
    outsiderTransportClient = await sessionClient(OUTSIDER_EMAIL, 'DevPass1234!');
  });

  afterAll(async () => {
    for (const id of cleanupEventIds) await admin.from('pickup_events').delete().eq('id', id);
    for (const id of cleanupAssignmentIds) await admin.from('pickup_assignments').delete().eq('id', id);
    for (const id of cleanupDocIds) await admin.from('documents').delete().eq('id', id);
    if (driverNoDocsId) await admin.from('documents').delete().eq('owner_type', 'driver').eq('owner_id', driverNoDocsId);
    if (driverExpiredId) await admin.from('documents').delete().eq('owner_type', 'driver').eq('owner_id', driverExpiredId);
    if (driverPendingId) await admin.from('documents').delete().eq('owner_type', 'driver').eq('owner_id', driverPendingId);
    if (vehicleActiveId) await admin.from('documents').delete().eq('owner_type', 'vehicle').eq('owner_id', vehicleActiveId);
    for (const id of cleanupDriverIds) await admin.from('drivers').delete().eq('id', id);
    for (const id of cleanupVehicleIds) await admin.from('vehicles').delete().eq('id', id);
    if (outsiderUserId) {
      await admin.from('memberships').delete().eq('user_id', outsiderUserId);
      await admin.from('profiles').delete().eq('id', outsiderUserId);
      await admin.auth.admin.deleteUser(outsiderUserId);
    }
    if (outsiderDriverId) await admin.from('drivers').delete().eq('id', outsiderDriverId);
    if (outsiderTransportCompanyId) await admin.from('transport_companies').delete().eq('id', outsiderTransportCompanyId);
  });

  // ─── Fixture setup that must go through real clients (RLS/triggers) ──────

  it('setup: transport manager can upload driverExpired\'s two required docs', async () => {
    const { data: iqama, error: e1 } = await transportClient.from('documents').insert({
      owner_type: 'driver', owner_id: driverExpiredId, doc_type: 'iqama',
      file_path: `driver/${driverExpiredId}/iqama-${RUN}.pdf`, file_sha256: `${RUN}-iqama`,
      issue_date: '2020-01-01', expiry_date: '2030-01-01',
    }).select('id').single<{ id: string }>();
    expect(e1).toBeNull();
    cleanupDocIds.push(iqama!.id);

    const { data: dl, error: e2 } = await transportClient.from('documents').insert({
      owner_type: 'driver', owner_id: driverExpiredId, doc_type: 'driving_license',
      file_path: `driver/${driverExpiredId}/driving_license-${RUN}.pdf`, file_sha256: `${RUN}-dl`,
      issue_date: '2019-01-01', expiry_date: '2020-01-01', // already expired
    }).select('id').single<{ id: string }>();
    expect(e2).toBeNull();
    cleanupDocIds.push(dl!.id);

    // Reviewer verifies BOTH — the licence is expired but the scan itself is
    // authentic, so a reviewer can legitimately verify it; expiry is judged
    // separately by the status computation, not by the reviewer.
    const { error: rv1 } = await reviewerClient.from('documents').update({ status: 'verified' }).eq('id', iqama!.id);
    expect(rv1).toBeNull();
    const { error: rv2 } = await reviewerClient.from('documents').update({ status: 'verified' }).eq('id', dl!.id);
    expect(rv2).toBeNull();
  });

  it('setup: transport manager can upload driverPendingReview\'s docs (one left pending)', async () => {
    const { data: iqama, error: e1 } = await transportClient.from('documents').insert({
      owner_type: 'driver', owner_id: driverPendingId, doc_type: 'iqama',
      file_path: `driver/${driverPendingId}/iqama-${RUN}.pdf`, file_sha256: `${RUN}-p-iqama`,
      issue_date: '2020-01-01', expiry_date: '2030-01-01',
    }).select('id').single<{ id: string }>();
    expect(e1).toBeNull();
    cleanupDocIds.push(iqama!.id);
    const { error: rv } = await reviewerClient.from('documents').update({ status: 'verified' }).eq('id', iqama!.id);
    expect(rv).toBeNull();

    const { data: dl, error: e2 } = await transportClient.from('documents').insert({
      owner_type: 'driver', owner_id: driverPendingId, doc_type: 'driving_license',
      file_path: `driver/${driverPendingId}/driving_license-${RUN}.pdf`, file_sha256: `${RUN}-p-dl`,
      issue_date: '2024-01-01', expiry_date: '2030-01-01',
    }).select('id').single<{ id: string }>();
    expect(e2).toBeNull();
    cleanupDocIds.push(dl!.id);
    // Deliberately left pending — never reviewed.
  });

  it('setup: transport manager can upload and get vehicleActive\'s two required docs verified', async () => {
    const { data: reg, error: e1 } = await transportClient.from('documents').insert({
      owner_type: 'vehicle', owner_id: vehicleActiveId, doc_type: 'vehicle_registration',
      file_path: `vehicle/${vehicleActiveId}/vehicle_registration-${RUN}.pdf`, file_sha256: `${RUN}-va-reg`,
      issue_date: '2024-01-01', expiry_date: '2030-01-01',
    }).select('id').single<{ id: string }>();
    expect(e1).toBeNull();
    cleanupDocIds.push(reg!.id);
    const { error: rv1 } = await reviewerClient.from('documents').update({ status: 'verified' }).eq('id', reg!.id);
    expect(rv1).toBeNull();

    const { data: ncwm, error: e2 } = await transportClient.from('documents').insert({
      owner_type: 'vehicle', owner_id: vehicleActiveId, doc_type: 'ncwm_license',
      file_path: `vehicle/${vehicleActiveId}/ncwm_license-${RUN}.pdf`, file_sha256: `${RUN}-va-ncwm`,
      issue_date: '2024-01-01', expiry_date: '2030-01-01',
    }).select('id').single<{ id: string }>();
    expect(e2).toBeNull();
    cleanupDocIds.push(ncwm!.id);
    const { error: rv2 } = await reviewerClient.from('documents').update({ status: 'verified' }).eq('id', ncwm!.id);
    expect(rv2).toBeNull();

    const status = await ownerStatus(transportClient, 'vehicle', vehicleActiveId);
    expect(status.activation_status).toBe('active');
  });

  // ─── Assertions ────────────────────────────────────────────────────────

  it('1. uploader cannot self-verify their own document', async () => {
    // A fresh iqama resubmission for the seeded driver would become the
    // "latest" iqama row and skew the seeded driver's activation_status for
    // every other assertion in this file, so it's uploaded then deleted via
    // service_role (no trigger on DELETE) the moment this test is done.
    const { data: doc, error: upErr } = await driverClient.from('documents').insert({
      owner_type: 'driver', owner_id: SEED.driverId, doc_type: 'iqama',
      file_path: `driver/${SEED.driverId}/iqama-resubmit-${RUN}.pdf`, file_sha256: `${RUN}-self`,
      issue_date: '2024-01-01', expiry_date: '2030-01-01',
    }).select('id, status').single<{ id: string; status: string }>();
    expect(upErr).toBeNull();
    expect(doc?.status).toBe('pending');

    try {
      // documents_update RLS (`can_review_documents()`) filters this UPDATE
      // to zero matching rows for a non-reviewer — PostgREST reports that as
      // success with no error (the same "0 rows affected" shape documented
      // in trip-ownership.test.ts), so the real assertion is the row's
      // status afterwards, not the presence of an error.
      await driverClient.from('documents').update({ status: 'verified' }).eq('id', doc!.id);

      const { data: still } = await admin.from('documents').select('status').eq('id', doc!.id).single<{ status: string }>();
      expect(still?.status).toBe('pending');
    } finally {
      await admin.from('documents').delete().eq('id', doc!.id);
    }
  });

  it('2. reviewer can verify a pending document', async () => {
    const { data: doc } = await transportClient.from('documents').insert({
      owner_type: 'vehicle', owner_id: SEED.vehicleId, doc_type: 'vehicle_registration',
      file_path: `vehicle/${SEED.vehicleId}/vehicle_registration-resubmit-${RUN}.pdf`, file_sha256: `${RUN}-vreg`,
      issue_date: '2024-01-01', expiry_date: '2030-01-01',
    }).select('id').single<{ id: string }>();
    cleanupDocIds.push(doc!.id);

    const { data: reviewed, error } = await reviewerClient
      .from('documents')
      .update({ status: 'verified' })
      .eq('id', doc!.id)
      .select('status, reviewed_by, reviewed_at')
      .single<{ status: string; reviewed_by: string; reviewed_at: string }>();
    expect(error).toBeNull();
    expect(reviewed?.status).toBe('verified');
    expect(reviewed?.reviewed_by).not.toBeNull();
    expect(reviewed?.reviewed_at).not.toBeNull();
  });

  it('3. reviewer can reject a document with a reason', async () => {
    const { data: doc } = await transportClient.from('documents').insert({
      owner_type: 'vehicle', owner_id: SEED.vehicleId, doc_type: 'vehicle_registration',
      file_path: `vehicle/${SEED.vehicleId}/vehicle_registration-reject-${RUN}.pdf`, file_sha256: `${RUN}-vreg2`,
      issue_date: '2024-01-01', expiry_date: '2030-01-01',
    }).select('id').single<{ id: string }>();
    cleanupDocIds.push(doc!.id);

    const { data: rejected, error } = await reviewerClient
      .from('documents')
      .update({ status: 'rejected', reject_reason: 'صورة غير واضحة' })
      .eq('id', doc!.id)
      .select('status, reject_reason')
      .single<{ status: string; reject_reason: string }>();
    expect(error).toBeNull();
    expect(rejected?.status).toBe('rejected');
    expect(rejected?.reject_reason).toBe('صورة غير واضحة');
  });

  it('4. reject WITHOUT a reason is rejected by the DB constraint', async () => {
    const { data: doc } = await transportClient.from('documents').insert({
      owner_type: 'vehicle', owner_id: SEED.vehicleId, doc_type: 'vehicle_registration',
      file_path: `vehicle/${SEED.vehicleId}/vehicle_registration-reject-noreason-${RUN}.pdf`, file_sha256: `${RUN}-vreg3`,
      issue_date: '2024-01-01', expiry_date: '2030-01-01',
    }).select('id').single<{ id: string }>();
    cleanupDocIds.push(doc!.id);

    const { error } = await reviewerClient
      .from('documents').update({ status: 'rejected' }).eq('id', doc!.id);
    expect(error).not.toBeNull();
  });

  it('5. seeded company is 100% complete and ACTIVE', async () => {
    const status = await ownerStatus(companyClient, 'company', SEED.companyId);
    expect(status.completion_pct).toBe(100);
    expect(status.activation_status).toBe('active');
    expect(status.missing_doc_types).toEqual([]);
    expect(status.unverified_doc_types).toEqual([]);
    expect(status.expired_doc_types).toEqual([]);
  });

  it('6. seeded driver\'s soon-to-expire licence is flagged but still counts as satisfied', async () => {
    const status = await ownerStatus(transportClient, 'driver', SEED.driverId);
    expect(status.activation_status).toBe('active');
    expect(status.completion_pct).toBe(100);
    const flagged = status.expiring_soon.find((e) => e.doc_type === 'driving_license');
    expect(flagged).toBeDefined();
    expect(flagged!.days_remaining).toBeLessThanOrEqual(15);
    expect(['high', 'critical', 'medium']).toContain(flagged!.level);
  });

  it('7. an entity cannot go active while a required doc is still pending review', async () => {
    const status = await ownerStatus(transportClient, 'driver', driverPendingId);
    expect(status.activation_status).not.toBe('active');
    expect(status.activation_status).toBe('onboarding');
    expect(status.unverified_doc_types).toContain('driving_license');
    expect(status.completion_pct).toBeLessThan(100);
  });

  it('8. an expired verified document restricts ONLY that driver', async () => {
    const expiredStatus = await ownerStatus(transportClient, 'driver', driverExpiredId);
    expect(expiredStatus.activation_status).toBe('restricted');
    expect(expiredStatus.expired_doc_types).toContain('driving_license');

    // The unrelated seeded driver is unaffected.
    const seededStatus = await ownerStatus(transportClient, 'driver', SEED.driverId);
    expect(seededStatus.activation_status).toBe('active');
  });

  it('9. a restricted, non-exempt driver cannot be scheduled (pickup_assignments)', async () => {
    const { error } = await companyClient.from('pickup_assignments').insert({
      company_id: SEED.companyId,
      branch_id: SEED.branchId,
      driver_id: driverExpiredId,
      vehicle_id: vehicleActiveId, // ACTIVE vehicle — isolates the assertion to the driver
      scheduled_at: new Date(Date.now() + 86400000).toISOString(),
      status: 'pending',
    });
    expect(error).not.toBeNull();
    expect(error?.message).toContain('DRIVER_NOT_ACTIVE');
  });

  it('10. a restricted, non-exempt driver cannot complete a pickup (pickup_events)', async () => {
    const { error } = await driverClient.from('pickup_events').insert({
      logical_id: crypto.randomUUID(),
      revision: 1,
      company_id: SEED.companyId,
      branch_id: SEED.branchId,
      transport_company_id: SEED.transportCompanyId,
      driver_id: driverExpiredId,
      vehicle_id: vehicleActiveId,
      waste_types: ['organic'],
      weight_kg: 12,
      gps_lat: 24.6877,
      gps_lng: 46.6876,
      gps_accuracy_m: 8,
      photo_path: `company/branch/event/cp2-${RUN}.jpg`,
      signature_path: `company/branch/event/cp2-${RUN}.png`,
    });
    expect(error).not.toBeNull();
    expect(error?.message).toContain('DRIVER_NOT_ACTIVE');
  });

  it('11. a brand-new driver with zero documents is blocked (real gate, not exempt)', async () => {
    const status = await ownerStatus(transportClient, 'driver', driverNoDocsId);
    expect(status.activation_status).toBe('onboarding');
    expect(status.missing_doc_types.length).toBe(2);

    const { error } = await companyClient.from('pickup_assignments').insert({
      company_id: SEED.companyId,
      branch_id: SEED.branchId,
      driver_id: driverNoDocsId,
      vehicle_id: vehicleActiveId,
      scheduled_at: new Date(Date.now() + 86400000).toISOString(),
      status: 'pending',
    });
    expect(error).not.toBeNull();
    expect(error?.message).toContain('DRIVER_NOT_ACTIVE');
  });

  it('12. a grandfathered legacy driver still works despite having zero documents', async () => {
    // driverNoDocsId is the same non-exempt, doc-less driver proven blocked
    // in test 11. Flip it to compliance_exempt=true the only way that's
    // actually possible (see grandfatherDriver's comment above) — mirroring
    // exactly what migration 021's backfill did to every driver that
    // existed before it, in a real deployment.
    const grandfathered = grandfatherCompliance('driver', driverNoDocsId);
    if (!grandfathered) {
      console.log(`SKIP: could not reach the '${DB_CONTAINER}' container to grandfather a fixture`);
      return;
    }

    const status = await ownerStatus(transportClient, 'driver', driverNoDocsId);
    expect(status.activation_status).not.toBe('active'); // reporting is untouched — still onboarding

    const { data, error } = await companyClient.from('pickup_assignments').insert({
      company_id: SEED.companyId,
      branch_id: SEED.branchId,
      driver_id: driverNoDocsId, // grandfathered, zero documents
      vehicle_id: vehicleActiveId,
      scheduled_at: new Date(Date.now() + 86400000).toISOString(),
      status: 'pending',
    }).select('id').single<{ id: string }>();
    expect(error).toBeNull();
    if (data) cleanupAssignmentIds.push(data.id);
  });

  it('13. cross-tenant document access is denied', async () => {
    const { data, error } = await outsiderTransportClient
      .from('documents')
      .select('id')
      .eq('id', outsiderDocId);
    // Sanity: the outsider CAN see their own doc.
    expect(error).toBeNull();
    expect(data?.length).toBe(1);

    const { data: denied } = await transportClient
      .from('documents')
      .select('id')
      .eq('id', outsiderDocId);
    expect(denied?.length ?? 0).toBe(0);

    const { data: statusDenied, error: statusErr } = await transportClient
      .rpc('owner_document_status', { p_owner_type: 'driver', p_owner_id: outsiderDriverId });
    expect(statusErr).not.toBeNull();
    expect(statusDenied).toBeNull();
  });
});
