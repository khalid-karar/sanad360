/**
 * gov_rollup() — k-anonymity + differencing protection (Migration 031)
 *
 * Fixtures (dedicated companies/branches/region, never touching shared SEED
 * data — this test's own region SA-08 is deliberately unused by any other
 * test file to avoid cross-test aggregation leakage under parallel runs)
 * are created via service_role — SETUP ONLY. The actual RLS/authorization
 * assertions run as real signed-in users (gov_viewer, a non-privileged
 * manager) calling the RPC through their own session.
 *
 * IMPORTANT: every assertion below queries gov_rollup() WITH a region_code
 * filter (industry-level, scoped to REGION=SA-08) — never the unfiltered
 * top-level region list. An unfiltered gov_rollup(NULL,NULL,NULL) call
 * aggregates over the ENTIRE shared test database, including whatever
 * OTHER test files' pickups exist at that instant (this repo's suite runs
 * many files concurrently against one Postgres instance) — asserting
 * anything about that result would be inherently non-deterministic. Every
 * assertion here is instead scoped to a region this file alone populates,
 * which is fully isolated from concurrent test execution.
 *
 * Assertions:
 *   1. A region+industry cell containing only 1 company is suppressed
 *      (below the seeded default threshold of 5)
 *   2. Complementary suppression: with 3 industry siblings under one
 *      region — big (9), majority (6), minority (1) — exactly one
 *      (minority) is primarily suppressed. The smaller of the two
 *      otherwise-visible siblings (majority, 6) is ALSO suppressed, so
 *      minority's exact value can't be recovered by subtracting majority
 *      from (region total - big) — while big (9, the largest) stays
 *      visible with real numbers, since complementary suppression only
 *      needs to hide ONE additional cell to break the differencing
 *      equation.
 *   3. (same fixture) demonstrates a cell meeting the threshold AND
 *      surviving complementary suppression shows real numbers
 *   4. The aggregate RPC is the ONLY path: a real signed-in gov_viewer
 *      querying pickup_events/drivers/companies directly gets zero rows
 *      (existing RLS already excludes it — nothing new needed, but proven)
 *   5. A non-privileged, real signed-in user (ordinary company manager)
 *      calling gov_rollup() directly is rejected
 *   6. Suppressed cells never render as zero — every numeric field is NULL
 *      when is_suppressed=true
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { grandfatherCompliance } from './testHelpers/complianceExempt';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY ?? '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

if (!ANON_KEY || !SERVICE_KEY) {
  throw new Error('Set VITE_SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY in .env.');
}

const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
const anon = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });

const SEED = {
  managerEmail: 'manager@sanad360.dev',
  transportCompanyId: 'c0000000-0000-0000-0000-000000000001',
  driverId: 'd0000000-0000-0000-0000-000000000001',
  vehicleId: 'e0000000-0000-0000-0000-000000000001',
  password: 'DevPass1234!',
};

const RUN = Date.now();
const REGION = 'SA-08'; // Northern Borders — dedicated to this test file only
const BIG_INDUSTRY = 'oil_gas_petrochem';       // 9 companies — clearly the largest, stays visible
const MAJORITY_INDUSTRY = 'manufacturing';       // 6 companies — passes threshold alone, but is
                                                  // the SMALLEST visible sibling once complementary
                                                  // suppression must hide one (see test 2)
const MINORITY_INDUSTRY = 'automotive_workshops'; // 1 company — primarily suppressed (below threshold)

interface RollupRow {
  level: string;
  group_key: string | null;
  label_ar: string;
  label_en: string;
  is_suppressed: boolean;
  n_companies: number | null;
  total_pickups: number | null;
  total_weight_kg: number | null;
  compliant_count: number | null;
  warning_count: number | null;
  non_compliant_count: number | null;
  pending_confirmation_count: number | null;
}

async function sessionClient(email: string, password = SEED.password): Promise<SupabaseClient> {
  const { data, error } = await anon.auth.signInWithPassword({ email, password });
  if (error || !data.session) throw new Error(`sign-in failed (${email}): ${error?.message}`);
  return createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${data.session.access_token}` } },
  });
}

describe('gov_rollup() — k-anonymity + differencing protection (Migration 031)', () => {
  let govUserId = '';
  let govClient: SupabaseClient;
  let managerClient: SupabaseClient;

  const cleanupEventIds: string[] = [];
  const cleanupBranchIds: string[] = [];
  const cleanupCompanyIds: string[] = [];

  async function makeCompanyWithPickup(industryCode: string, n: number): Promise<void> {
    for (let i = 0; i < n; i++) {
      const { data: company } = await admin
        .from('companies')
        .insert({
          name_ar: `شركة تجميع ${industryCode} ${i}-${RUN}`,
          commercial_registration: `GOVAGG-${industryCode}-${i}-${RUN}`,
          industry_code: industryCode,
        })
        .select('id')
        .single<{ id: string }>();
      cleanupCompanyIds.push(company!.id);
      grandfatherCompliance('company', company!.id);

      const { data: branch } = await admin
        .from('branches')
        .insert({ company_id: company!.id, name_ar: `فرع ${i}`, region_code: REGION })
        .select('id')
        .single<{ id: string }>();
      cleanupBranchIds.push(branch!.id);

      const { data: event } = await admin
        .from('pickup_events')
        .insert({
          logical_id: crypto.randomUUID(),
          revision: 1,
          company_id: company!.id,
          branch_id: branch!.id,
          transport_company_id: SEED.transportCompanyId,
          driver_id: SEED.driverId,
          vehicle_id: SEED.vehicleId,
          waste_types: ['organic'],
          weight_kg: 10,
          photo_path: 'p.jpg',
          signature_path: 's.png',
          qr_skip_reason: 'not_applicable_for_stream',
        })
        .select('id')
        .single<{ id: string }>();
      cleanupEventIds.push(event!.id);
    }
  }

  beforeAll(async () => {
    // 9 companies — clearly the largest sibling, stays visible even after
    // complementary suppression sacrifices the smaller of the two
    // otherwise-visible cells.
    await makeCompanyWithPickup(BIG_INDUSTRY, 9);
    // 6 companies — passes threshold=5 alone, but is the SMALLEST of the two
    // visible siblings once exactly one (minority) is primarily suppressed.
    await makeCompanyWithPickup(MAJORITY_INDUSTRY, 6);
    // 1 company — below threshold, primarily suppressed.
    await makeCompanyWithPickup(MINORITY_INDUSTRY, 1);

    const email = `gov-viewer-${RUN}@maya.sanad360.dev`;
    const { data: created } = await admin.auth.admin.createUser({
      email, password: SEED.password, email_confirm: true,
    });
    govUserId = created.user!.id;
    await admin.from('memberships').insert({ user_id: govUserId, role: 'gov_viewer' });
    govClient = await sessionClient(email);
    managerClient = await sessionClient(SEED.managerEmail);
  });

  afterAll(async () => {
    if (cleanupEventIds.length) await admin.from('pickup_events').delete().in('id', cleanupEventIds);
    if (cleanupBranchIds.length) await admin.from('branches').delete().in('id', cleanupBranchIds);
    if (cleanupCompanyIds.length) await admin.from('companies').delete().in('id', cleanupCompanyIds);
    if (govUserId) {
      await admin.from('memberships').delete().eq('user_id', govUserId);
      await admin.from('profiles').delete().eq('id', govUserId);
      await admin.auth.admin.deleteUser(govUserId);
    }
  });

  it('1+2+3. minority industry (1 company) is suppressed; majority industry is ALSO suppressed (complementary — cannot be recovered by differencing); a real signed-in gov_viewer sees this via its own session', async () => {
    const { data, error } = await govClient.rpc('gov_rollup', {
      p_region_code: REGION, p_industry_code: null, p_facility_id: null,
    });
    expect(error).toBeNull();
    const rows = data as RollupRow[];

    const majority = rows.find((r) => r.group_key === MAJORITY_INDUSTRY);
    const minority = rows.find((r) => r.group_key === MINORITY_INDUSTRY);
    expect(majority).toBeDefined();
    const big = rows.find((r) => r.group_key === BIG_INDUSTRY);
    expect(minority).toBeDefined();
    expect(big).toBeDefined();

    // Minority: primarily suppressed (1 company < threshold 5).
    expect(minority!.is_suppressed).toBe(true);
    // Majority: would pass on its own (6 >= 5), but is the SMALLER of the two
    // otherwise-visible siblings once exactly one (minority) is primarily
    // suppressed — complementary suppression must hide it too, otherwise
    // minority's exact value = region_total - majority_total - big_total.
    expect(majority!.is_suppressed).toBe(true);
    // Big (9 companies, the larger visible sibling) is NOT sacrificed —
    // complementary suppression only needs to hide ONE additional cell to
    // break the differencing equation, and sacrifices the smallest visible
    // one to preserve maximum data utility.
    expect(big!.is_suppressed).toBe(false);
    expect(big!.n_companies).toBe(9);
    expect(big!.total_pickups).toBe(9);

    // 6. Never zero, never a number — every metric NULL when suppressed.
    for (const row of [majority!, minority!]) {
      expect(row.n_companies).toBeNull();
      expect(row.total_pickups).toBeNull();
      expect(row.total_weight_kg).toBeNull();
      expect(row.compliant_count).toBeNull();
      expect(row.warning_count).toBeNull();
      expect(row.non_compliant_count).toBeNull();
      expect(row.pending_confirmation_count).toBeNull();
    }
  });

  it('4. the aggregate RPC is the ONLY path — raw pickup_events/drivers/companies denied to gov_viewer', async () => {
    const [{ data: rawEvents }, { data: rawDrivers }, { data: rawCompanies }] = await Promise.all([
      govClient.from('pickup_events').select('id').limit(5),
      govClient.from('drivers').select('id, name_ar').limit(5),
      govClient.from('companies').select('id, name_ar').limit(5),
    ]);
    expect(rawEvents ?? []).toHaveLength(0);
    expect(rawDrivers ?? []).toHaveLength(0);
    expect(rawCompanies ?? []).toHaveLength(0);
  });

  it('5. a non-privileged real signed-in user (company manager) is rejected calling gov_rollup', async () => {
    const { data, error } = await managerClient.rpc('gov_rollup', {
      p_region_code: null, p_industry_code: null, p_facility_id: null,
    });
    expect(error).not.toBeNull();
    expect(data).toBeNull();
  });
});

describe('gov_rollup() — complementary suppression tiebreak is deterministic (Migration 031)', () => {
  // A dedicated region (SA-06, never touched by the describe block above or
  // any other test file) with two industries tied at EXACTLY the same
  // company count, plus one minority industry to force exactly one primary
  // suppression — the scenario where the tiebreak actually matters, since
  // ORDER BY co_count ASC alone can't distinguish the tied pair.
  const TIE_REGION = 'SA-06';
  const TIE_A = 'agriculture';           // group_key 'agriculture' < 'education' —
  const TIE_B = 'education';             // the documented tiebreak (group_key ASC)
  const TIE_MINORITY = 'healthcare';     // must always sacrifice TIE_A, never TIE_B.
  let govUserId2A = '';
  let govUserId2B = '';
  let govClient2A: SupabaseClient;
  let govClient2B: SupabaseClient; // a SECOND, independently signed-in session
  const cleanupEventIds2: string[] = [];
  const cleanupBranchIds2: string[] = [];
  const cleanupCompanyIds2: string[] = [];

  async function makeTieCompanyWithPickup(industryCode: string, n: number): Promise<void> {
    for (let i = 0; i < n; i++) {
      const { data: company } = await admin
        .from('companies')
        .insert({
          name_ar: `شركة تعادل ${industryCode} ${i}-${RUN}`,
          commercial_registration: `GOVTIE-${industryCode}-${i}-${RUN}`,
          industry_code: industryCode,
        })
        .select('id')
        .single<{ id: string }>();
      cleanupCompanyIds2.push(company!.id);
      grandfatherCompliance('company', company!.id);

      const { data: branch } = await admin
        .from('branches')
        .insert({ company_id: company!.id, name_ar: `فرع تعادل ${i}`, region_code: TIE_REGION })
        .select('id')
        .single<{ id: string }>();
      cleanupBranchIds2.push(branch!.id);

      const { data: event } = await admin
        .from('pickup_events')
        .insert({
          logical_id: crypto.randomUUID(),
          revision: 1,
          company_id: company!.id,
          branch_id: branch!.id,
          transport_company_id: SEED.transportCompanyId,
          driver_id: SEED.driverId,
          vehicle_id: SEED.vehicleId,
          waste_types: ['organic'],
          weight_kg: 10,
          photo_path: 'p.jpg',
          signature_path: 's.png',
          qr_skip_reason: 'not_applicable_for_stream',
        })
        .select('id')
        .single<{ id: string }>();
      cleanupEventIds2.push(event!.id);
    }
  }

  beforeAll(async () => {
    await makeTieCompanyWithPickup(TIE_A, 6);
    await makeTieCompanyWithPickup(TIE_B, 6);
    await makeTieCompanyWithPickup(TIE_MINORITY, 1);

    const email2A = `gov-viewer-tie-a-${RUN}@maya.sanad360.dev`;
    const { data: createdA } = await admin.auth.admin.createUser({ email: email2A, password: SEED.password, email_confirm: true });
    govUserId2A = createdA.user!.id;
    await admin.from('memberships').insert({ user_id: govUserId2A, role: 'gov_viewer' });
    govClient2A = await sessionClient(email2A);

    // A second, independent gov_viewer account+session — "reached via two
    // different [callers'] paths" should still land on the identical result.
    const email2B = `gov-viewer-tie-b-${RUN}@maya.sanad360.dev`;
    const { data: createdB } = await admin.auth.admin.createUser({ email: email2B, password: SEED.password, email_confirm: true });
    govUserId2B = createdB.user!.id;
    await admin.from('memberships').insert({ user_id: govUserId2B, role: 'gov_viewer' });
    govClient2B = await sessionClient(email2B);
  });

  afterAll(async () => {
    if (cleanupEventIds2.length) await admin.from('pickup_events').delete().in('id', cleanupEventIds2);
    if (cleanupBranchIds2.length) await admin.from('branches').delete().in('id', cleanupBranchIds2);
    if (cleanupCompanyIds2.length) await admin.from('companies').delete().in('id', cleanupCompanyIds2);
    for (const uid of [govUserId2A, govUserId2B]) {
      if (!uid) continue;
      await admin.from('memberships').delete().eq('user_id', uid);
      await admin.from('profiles').delete().eq('id', uid);
      await admin.auth.admin.deleteUser(uid).catch(() => {});
    }
  });

  it('always sacrifices the same sibling (group_key-ordered tiebreak), across repeated calls and across two independent gov_viewer sessions', async () => {
    const clients = [govClient2A, govClient2A, govClient2A, govClient2B, govClient2A];
    for (const client of clients) {
      const { data, error } = await client.rpc('gov_rollup', {
        p_region_code: TIE_REGION, p_industry_code: null, p_facility_id: null,
      });
      expect(error).toBeNull();
      const rows = data as RollupRow[];
      const a = rows.find((r) => r.group_key === TIE_A);
      const b = rows.find((r) => r.group_key === TIE_B);
      expect(a).toBeDefined();
      expect(b).toBeDefined();

      // TIE_A ('agriculture') sorts before TIE_B ('education') — the
      // documented tiebreak always sacrifices the group_key-ascending
      // rank-1 sibling among the tied pair.
      expect(a!.is_suppressed).toBe(true);
      expect(b!.is_suppressed).toBe(false);
      expect(b!.n_companies).toBe(6);
    }
  });
});
