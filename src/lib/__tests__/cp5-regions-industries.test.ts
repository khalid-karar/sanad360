/**
 * regions + industries lookup tables (Migrations 027/028)
 *
 * Assertions:
 *   1. regions has all 13 rows, seeded from the canonical ISO 3166-2:SA
 *      codes — including the real gap at SA-13 (never invented/reused)
 *   2. industries has all 14 seeded rows, active by default
 *   3. Both are readable by a real signed-in user (not just service_role)
 *   4. branches.region_code accepts a valid code (real manager, own branch)
 *      and rejects an invalid one (FK violation)
 *   5. companies.industry_code accepts a valid code and rejects an invalid
 *      one (FK violation)
 *   6. facilities.region_code accepts a valid code and rejects an invalid one
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY ?? '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

if (!ANON_KEY || !SERVICE_KEY) {
  throw new Error('Set VITE_SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY in .env.');
}

const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
const anon = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });

const SEED = {
  companyId: 'a0000000-0000-0000-0000-000000000001',
  branchId: 'b0000000-0000-0000-0000-000000000001',
  managerEmail: 'manager@sanad360.dev',
  password: 'DevPass1234!',
};

const RUN = Date.now();

async function managerClient(): Promise<SupabaseClient> {
  const { data, error } = await anon.auth.signInWithPassword({
    email: SEED.managerEmail,
    password: SEED.password,
  });
  if (error || !data.session) throw new Error(`sign-in failed: ${error?.message}`);
  return createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${data.session.access_token}` } },
  });
}

describe('regions + industries (Migrations 027/028)', () => {
  let manager: SupabaseClient;
  let facilityId = '';
  let originalBranchRegion: string | null = null;

  beforeAll(async () => {
    manager = await managerClient();

    const { data: facility } = await admin
      .from('facilities')
      .insert({
        name_ar: `منشأة اختبار المناطق ${RUN}`,
        license_number: `RGN-${RUN}`,
        license_expiry: '2030-01-01',
        city: 'Riyadh',
      })
      .select('id')
      .single<{ id: string }>();
    facilityId = facility!.id;

    const { data: branch } = await admin
      .from('branches')
      .select('region_code')
      .eq('id', SEED.branchId)
      .single<{ region_code: string | null }>();
    originalBranchRegion = branch?.region_code ?? null;
  });

  afterAll(async () => {
    await admin.from('branches').update({ region_code: originalBranchRegion }).eq('id', SEED.branchId);
    if (facilityId) await admin.from('facilities').delete().eq('id', facilityId);
  });

  it('1. regions has all 13 rows, including the SA-13 gap', async () => {
    const { data, error } = await manager.from('regions').select('code').order('code');
    expect(error).toBeNull();
    const codes = (data ?? []).map((r) => r.code);
    expect(codes).toHaveLength(13);
    expect(codes).toContain('SA-01');
    expect(codes).toContain('SA-14');
    expect(codes).not.toContain('SA-13');
  });

  it('2. industries has all 14 seeded rows, active by default', async () => {
    const { data, error } = await manager.from('industries').select('code, is_active');
    expect(error).toBeNull();
    expect(data).toHaveLength(14);
    expect(data!.every((i) => i.is_active)).toBe(true);
    expect(data!.map((i) => i.code)).toContain('food_beverage');
  });

  it('3. both lookup tables are readable by a real signed-in user', async () => {
    const [{ error: regionsErr }, { error: industriesErr }] = await Promise.all([
      manager.from('regions').select('code').limit(1),
      manager.from('industries').select('code').limit(1),
    ]);
    expect(regionsErr).toBeNull();
    expect(industriesErr).toBeNull();
  });

  it("4. branches.region_code accepts a valid code (real manager, own branch) and rejects an invalid one", async () => {
    const { error: okErr } = await manager
      .from('branches')
      .update({ region_code: 'SA-01' })
      .eq('id', SEED.branchId);
    expect(okErr).toBeNull();

    const { data: after } = await admin
      .from('branches')
      .select('region_code')
      .eq('id', SEED.branchId)
      .single<{ region_code: string }>();
    expect(after!.region_code).toBe('SA-01');

    const { error: badErr } = await manager
      .from('branches')
      .update({ region_code: 'SA-99' })
      .eq('id', SEED.branchId);
    expect(badErr).not.toBeNull();
  });

  it('5. companies.industry_code accepts a valid code and rejects an invalid one', async () => {
    const { error: okErr } = await admin
      .from('companies')
      .update({ industry_code: 'logistics_warehousing' })
      .eq('id', SEED.companyId);
    expect(okErr).toBeNull();

    const { error: badErr } = await admin
      .from('companies')
      .update({ industry_code: 'not_a_real_industry' })
      .eq('id', SEED.companyId);
    expect(badErr).not.toBeNull();

    // Restore.
    await admin.from('companies').update({ industry_code: null }).eq('id', SEED.companyId);
  });

  it('6. facilities.region_code accepts a valid code and rejects an invalid one', async () => {
    const { error: okErr } = await admin
      .from('facilities')
      .update({ region_code: 'SA-04' })
      .eq('id', facilityId);
    expect(okErr).toBeNull();

    const { error: badErr } = await admin
      .from('facilities')
      .update({ region_code: 'XX-00' })
      .eq('id', facilityId);
    expect(badErr).not.toBeNull();
  });
});
