/**
 * evidence_requirements RLS + resolve_required_evidence() privilege boundary
 * (Migration 022)
 *
 * resolve_required_evidence() must be SECURITY INVOKER, not DEFINER: the
 * function reads evidence_requirements, whose RLS (022/B1) restricts
 * tenant-specific rows to that tenant's own members. If the function ran as
 * DEFINER, any signed-in user could pass an arbitrary transport_company_id
 * argument and read another transporter's custom evidence policy straight
 * through the function, bypassing RLS entirely.
 *
 * This proves: transporter A, calling resolve_required_evidence() with
 * transporter B's transport_company_id, does NOT receive B's custom
 * requirements — it falls through to the global default (tier 4), exactly
 * as if B had no custom row at all.
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

const RUN = Date.now();

// Transporter A: the seeded tenant. Transporter B: a second, unrelated
// pre-seeded transport company (seed.sql inserts it specifically so it's
// available but never linked to transporter A's tenant).
const TRANSPORTER_A_ID = 'c0000000-0000-0000-0000-000000000001';
const TRANSPORTER_B_ID = 'c0000000-0000-0000-0000-000000000002';

async function sessionClient(email: string, password: string): Promise<SupabaseClient> {
  const { data, error } = await anon.auth.signInWithPassword({ email, password });
  if (error || !data.session) throw new Error(`sign-in failed (${email}): ${error?.message}`);
  return createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${data.session.access_token}` } },
  });
}

describe('evidence_requirements RLS + resolve_required_evidence() (Migration 022)', () => {
  let userAId = '';
  let clientA: SupabaseClient;
  let bCustomRowId = '';
  const email = `transporter-a-${RUN}@transporter.sanad360.dev`;
  const password = 'DevPass1234!';

  beforeAll(async () => {
    // Transporter B gets a custom evidence policy that requires 'receipt' —
    // an item the global default (tier 4) does NOT require — so leaking it
    // is unambiguously detectable.
    const { data: bRow, error: bErr } = await admin
      .from('evidence_requirements')
      .insert({
        waste_stream: '*',
        transport_company_id: TRANSPORTER_B_ID,
        required_items: ['qr', 'geofenced_gps', 'photo', 'signature', 'receipt'],
      })
      .select('id')
      .single<{ id: string }>();
    if (bErr) throw new Error(`seed B custom row failed: ${bErr.message}`);
    bCustomRowId = bRow.id;

    // A member of transporter A only (no membership in B).
    const { data: created } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    userAId = created.user!.id;
    await admin.from('memberships').insert({
      user_id: userAId,
      role: 'driver',
      transport_company_id: TRANSPORTER_A_ID,
    });

    clientA = await sessionClient(email, password);
  });

  afterAll(async () => {
    if (bCustomRowId) await admin.from('evidence_requirements').delete().eq('id', bCustomRowId);
    if (userAId) {
      await admin.from('memberships').delete().eq('user_id', userAId);
      await admin.from('profiles').delete().eq('id', userAId);
      await admin.auth.admin.deleteUser(userAId);
    }
  });

  it("transporter A cannot read transporter B's custom evidence_requirements row directly", async () => {
    const { data } = await clientA
      .from('evidence_requirements')
      .select('id')
      .eq('transport_company_id', TRANSPORTER_B_ID);
    expect(data ?? []).toHaveLength(0);
  });

  it("resolve_required_evidence(B's id) called by A does NOT return B's custom 'receipt' requirement", async () => {
    const { data, error } = await clientA.rpc('resolve_required_evidence', {
      p_transport_company_id: TRANSPORTER_B_ID,
      p_waste_types: ['organic'],
    });
    expect(error).toBeNull();
    // Falls through to the global default (tier 4) — must NOT include the
    // tenant-specific item that only exists on B's row.
    expect(data as string[]).not.toContain('receipt');
    expect((data as string[]).sort()).toEqual(['geofenced_gps', 'photo', 'qr', 'signature']);
  });

  it('sanity: service_role (bypassing RLS) resolving for B directly still sees the custom row', async () => {
    const { data, error } = await admin.rpc('resolve_required_evidence', {
      p_transport_company_id: TRANSPORTER_B_ID,
      p_waste_types: ['organic'],
    });
    expect(error).toBeNull();
    expect(data as string[]).toContain('receipt');
  });
});
