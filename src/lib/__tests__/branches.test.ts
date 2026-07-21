/**
 * Prelaunch Bugfix Tests — Branch Creation (Bug 1)
 *
 * Regression coverage for the "branch create returns 403" bug. Root cause was a
 * missing table-level GRANT: migration 001 defined branches_insert/_update RLS
 * policies but only granted SELECT on public.branches to `authenticated`, so
 * every write failed with "permission denied for table branches" (42501) before
 * RLS was ever evaluated. Migration 006 adds the INSERT/UPDATE grants.
 *
 *   1. Manager can create a branch for their own company → row persists
 *   2. Manager is rejected when inserting with a different company_id (RLS)
 *
 * Prerequisites:
 *   supabase db reset   (applies 001..006 + seed)
 *   .env exports VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
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
  managerEmail: 'manager@sanad360.dev',
  managerPassword: 'DevPass1234!',
};

async function sessionClient(email: string, password: string): Promise<SupabaseClient> {
  const { data, error } = await anon.auth.signInWithPassword({ email, password });
  if (error || !data.session) throw new Error(`sign-in failed (${email}): ${error?.message}`);
  const jwt = data.session.access_token;
  return createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });
}

const cleanup = {
  branchIds: [] as string[],
  otherCompanyId: null as string | null,
};

describe('Bug 1 — Branch creation grants + RLS', () => {
  let managerClient: SupabaseClient;

  beforeAll(async () => {
    managerClient = await sessionClient(SEED.managerEmail, SEED.managerPassword);

    // A second company the manager does NOT belong to (for the rejection test).
    const stamp = Date.now();
    const { data: c2 } = await admin
      .from('companies')
      .insert({ name_ar: 'شركة أخرى', commercial_registration: `BR-C2-${stamp}` })
      .select('id')
      .single<{ id: string }>();
    cleanup.otherCompanyId = c2?.id ?? null;
  });

  afterAll(async () => {
    if (cleanup.branchIds.length)
      await admin.from('branches').delete().in('id', cleanup.branchIds);
    if (cleanup.otherCompanyId)
      await admin.from('companies').delete().eq('id', cleanup.otherCompanyId);
  });

  it('1. Manager can create a branch for their own company', async () => {
    const { data, error } = await managerClient
      .from('branches')
      .insert({
        company_id: SEED.companyId,
        name_ar: 'فرع الاختبار',
        name_en: 'Test Branch',
        geofence_radius_m: 150,
      })
      .select('id, company_id')
      .single<{ id: string; company_id: string }>();

    expect(error).toBeNull();
    expect(data).not.toBeNull();
    expect(data!.company_id).toBe(SEED.companyId);
    cleanup.branchIds.push(data!.id);

    // Persisted.
    const { data: read } = await admin
      .from('branches').select('id').eq('id', data!.id);
    expect(read).toHaveLength(1);
  });

  it('2. Manager is rejected when inserting with a different company_id', async () => {
    expect(cleanup.otherCompanyId).not.toBeNull();
    const { data, error } = await managerClient
      .from('branches')
      .insert({
        company_id: cleanup.otherCompanyId!,
        name_ar: 'فرع مرفوض',
        geofence_radius_m: 150,
      })
      .select();

    // RLS WITH CHECK rejects the cross-tenant row.
    expect(error).not.toBeNull();
    expect(data).toBeNull();

    // Nothing leaked into the other company.
    const { data: leaked } = await admin
      .from('branches').select('id').eq('company_id', cleanup.otherCompanyId!);
    expect(leaked).toHaveLength(0);
  });
});
