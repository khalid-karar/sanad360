/**
 * Phase 3c Acceptance Tests — Company ↔ Transporter Links
 *
 * Covers the company_transporters many-to-many link + RLS + the scheduling
 * resolver getDriversAndVehiclesForCompany() against a live local Supabase.
 *
 *   1. Manager can add a link
 *   2. Manager can deactivate a link
 *   3. Tenant isolation — company A can't see company B's links
 *   4. Transporter can see links referencing it (seeded driver in seeded TC)
 *   5. getDriversAndVehiclesForCompany returns seeded driver+vehicle via the link
 *   6. getDriversAndVehiclesForCompany returns empty when no links exist
 *
 * Prerequisites:
 *   supabase db reset          (applies 001 + 002 + 003 + 004 + seed)
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
  transportCompanyId: 'c0000000-0000-0000-0000-000000000001',
  driverId: 'd0000000-0000-0000-0000-000000000001',
  vehicleId: 'e0000000-0000-0000-0000-000000000001',
  linkId: 'f1000000-0000-0000-0000-000000000001',
  managerEmail: 'manager@tadweer360.dev',
  managerPassword: 'DevPass1234!',
  driverEmail: '0501234567@driver.tadweer360.com',
  driverPassword: 'DevPass1234!',
};

/**
 * Mirrors src/lib/api/companyTransporters.ts → getDriversAndVehiclesForCompany,
 * run against an explicit client so we can exercise the RLS-scoped path.
 */
async function getDriversAndVehiclesForCompany(client: SupabaseClient, companyId: string) {
  const { data: links, error: linkErr } = await client
    .from('company_transporters')
    .select('transport_company_id')
    .eq('company_id', companyId)
    .eq('status', 'active');
  if (linkErr) throw linkErr;

  const tcIds = (links ?? []).map((l: { transport_company_id: string }) => l.transport_company_id);
  if (tcIds.length === 0) return { drivers: [], vehicles: [] };

  const [d, v] = await Promise.all([
    client.from('drivers').select('*').in('transport_company_id', tcIds).eq('status', 'active'),
    client.from('vehicles').select('*').in('transport_company_id', tcIds).eq('status', 'active'),
  ]);
  if (d.error) throw d.error;
  if (v.error) throw v.error;
  return { drivers: d.data ?? [], vehicles: v.data ?? [] };
}

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
  addedLinkIds: [] as string[],
  company2Id: null as string | null,
  company2LinkId: null as string | null,
};

describe('Phase 3c — Company Transporters', () => {
  let managerClient: SupabaseClient;
  let driverClient: SupabaseClient;
  let secondTransportCompanyId: string | null = null;

  beforeAll(async () => {
    const { data: seedCheck } = await admin
      .from('company_transporters').select('id').eq('id', SEED.linkId).maybeSingle();
    if (!seedCheck) throw new Error('Seed link missing — run `supabase db reset`.');

    managerClient = await sessionClient(SEED.managerEmail, SEED.managerPassword);
    driverClient = await sessionClient(SEED.driverEmail, SEED.driverPassword);

    const stamp = Date.now();

    // A second transport company the manager can link to (test 1).
    const { data: tc2 } = await admin
      .from('transport_companies')
      .insert({ name_ar: 'شركة نقل ثانية', commercial_registration: `TC2-${stamp}` })
      .select('id').single<{ id: string }>();
    secondTransportCompanyId = tc2?.id ?? null;

    // A second company with NO links (tests 3 + 6).
    const { data: c2 } = await admin
      .from('companies')
      .insert({ name_ar: 'شركة بلا ناقل', commercial_registration: `C2-${stamp}` })
      .select('id').single<{ id: string }>();
    cleanup.company2Id = c2?.id ?? null;

    // Give company2 a link to the seeded TC (so test 3 has something to NOT see).
    if (cleanup.company2Id) {
      const { data: l2 } = await admin
        .from('company_transporters')
        .insert({
          company_id: cleanup.company2Id,
          transport_company_id: SEED.transportCompanyId,
          status: 'active',
        })
        .select('id').single<{ id: string }>();
      cleanup.company2LinkId = l2?.id ?? null;
    }
  });

  afterAll(async () => {
    if (cleanup.addedLinkIds.length)
      await admin.from('company_transporters').delete().in('id', cleanup.addedLinkIds);
    if (cleanup.company2LinkId)
      await admin.from('company_transporters').delete().eq('id', cleanup.company2LinkId);
    if (cleanup.company2Id)
      await admin.from('companies').delete().eq('id', cleanup.company2Id);
    if (secondTransportCompanyId)
      await admin.from('transport_companies').delete().eq('id', secondTransportCompanyId);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  it('1. Manager can add a link', async () => {
    expect(secondTransportCompanyId).not.toBeNull();
    const { data, error } = await managerClient
      .from('company_transporters')
      .insert({
        company_id: SEED.companyId,
        transport_company_id: secondTransportCompanyId!,
        status: 'active',
      })
      .select()
      .single<{ id: string; status: string }>();

    expect(error).toBeNull();
    expect(data).not.toBeNull();
    expect(data!.status).toBe('active');
    cleanup.addedLinkIds.push(data!.id);

    // Persisted + visible.
    const { data: read } = await admin
      .from('company_transporters').select('id').eq('id', data!.id);
    expect(read).toHaveLength(1);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  it('2. Manager can deactivate a link', async () => {
    expect(cleanup.addedLinkIds.length).toBeGreaterThan(0);
    const id = cleanup.addedLinkIds[0];

    const { data, error } = await managerClient
      .from('company_transporters')
      .update({ status: 'inactive' })
      .eq('id', id)
      .select('status')
      .single<{ status: string }>();

    expect(error).toBeNull();
    expect(data!.status).toBe('inactive');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  it("3. Tenant isolation — company A manager can't see company B's links", async () => {
    expect(cleanup.company2Id).not.toBeNull();
    const { data, error } = await managerClient
      .from('company_transporters')
      .select('id')
      .eq('company_id', cleanup.company2Id!);

    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  it('4. Transporter can see links referencing it', async () => {
    // The seeded driver belongs to the seeded transport company; the seeded link
    // references that TC, so the transporter-arm of the SELECT policy applies.
    const { data, error } = await driverClient
      .from('company_transporters')
      .select('id, company_id, transport_company_id')
      .eq('transport_company_id', SEED.transportCompanyId);

    expect(error).toBeNull();
    expect(data!.length).toBeGreaterThanOrEqual(1);
    expect(data!.some((r: { id: string }) => r.id === SEED.linkId)).toBe(true);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  it('5. getDriversAndVehiclesForCompany returns seeded data via link', async () => {
    const { drivers, vehicles } = await getDriversAndVehiclesForCompany(
      managerClient,
      SEED.companyId
    );
    expect(drivers.length).toBeGreaterThanOrEqual(1);
    expect(vehicles.length).toBeGreaterThanOrEqual(1);
    expect(drivers.some((d: { id: string }) => d.id === SEED.driverId)).toBe(true);
    expect(vehicles.some((v: { id: string }) => v.id === SEED.vehicleId)).toBe(true);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  it('6. getDriversAndVehiclesForCompany returns empty when no links', async () => {
    // company2's only link is inactive-eligible? No — it's active. Deactivate it
    // so company2 has no ACTIVE links, then assert empty pools (use admin client
    // to read regardless of RLS — the resolver only depends on active links).
    expect(cleanup.company2LinkId).not.toBeNull();
    await admin
      .from('company_transporters')
      .update({ status: 'inactive' })
      .eq('id', cleanup.company2LinkId!);

    const { drivers, vehicles } = await getDriversAndVehiclesForCompany(
      admin,
      cleanup.company2Id!
    );
    expect(drivers).toHaveLength(0);
    expect(vehicles).toHaveLength(0);
  });
});
