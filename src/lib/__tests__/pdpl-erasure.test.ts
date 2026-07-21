/**
 * PDPL Erasure (Migration 015)
 *
 * Verifies the crypto-shred/tombstone design: erasing a driver destroys every
 * direct identifier in the MUTABLE tables while the append-only ledger keeps
 * its rows (now pseudonymous) and referential integrity.
 *
 * Assertions:
 *   1. erase_driver_pii tombstones drivers + profiles, deletes memberships,
 *      writes an erasure_log row — and the driver's ledger event SURVIVES
 *      with created_by intact (FK to the tombstoned profile)
 *   2. authenticated users can NOT execute the function (service_role only)
 *   3. authenticated users can NOT read erasure_log
 *   4. idempotent: erasing an already-erased driver succeeds
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { grandfatherCompliance } from './testHelpers/complianceExempt';

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
  branchId:           'b0000000-0000-0000-0000-000000000001',
  transportCompanyId: 'c0000000-0000-0000-0000-000000000001',
  vehicleId:          'e0000000-0000-0000-0000-000000000001',
  managerEmail:       'manager@sanad360.dev',
  password:           'DevPass1234!',
};

const RUN = Date.now();

describe('PDPL erasure (Migration 015)', () => {
  let driverId = '';
  let userId = '';
  let eventId = '';
  let managerClient: SupabaseClient;

  beforeAll(async () => {
    // A driver WITH a linked account, membership, and one ledger event.
    const { data: created } = await admin.auth.admin.createUser({
      email: `erase-me-${RUN}@driver.sanad360.com`,
      password: SEED.password,
      email_confirm: true,
      user_metadata: { name_ar: 'سائق سيُمحى' },
    });
    userId = created.user!.id;

    await admin.from('profiles').upsert(
      { id: userId, name_ar: 'سائق سيُمحى', phone: '0599999999' },
      { onConflict: 'id' }
    );
    await admin.from('memberships').insert({
      user_id: userId,
      role: 'driver',
      transport_company_id: SEED.transportCompanyId,
    });

    const { data: d } = await admin
      .from('drivers')
      .insert({
        transport_company_id: SEED.transportCompanyId,
        profile_id: userId,
        name_ar: 'سائق سيُمحى',
        license_number: `ERASE-${RUN}`,
        license_expiry: '2030-01-01',
      })
      .select('id')
      .single<{ id: string }>();
    driverId = d!.id;
    // This suite predates CP2's document gate and isn't testing it —
    // grandfather the fixture so it doesn't get blocked from completing a
    // pickup (see testHelpers/complianceExempt.ts).
    grandfatherCompliance('driver', driverId);

    const { data: ev } = await admin
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
        weight_kg: 12,
        created_by: userId,
      })
      .select('id')
      .single<{ id: string }>();
    eventId = ev!.id;

    const { data: session, error } = await anon.auth.signInWithPassword({
      email: SEED.managerEmail,
      password: SEED.password,
    });
    if (error) throw error;
    managerClient = createClient(SUPABASE_URL, ANON_KEY, {
      auth: { persistSession: false },
      global: { headers: { Authorization: `Bearer ${session.session!.access_token}` } },
    });
  });

  afterAll(async () => {
    if (eventId) await admin.from('pickup_events').delete().eq('id', eventId);
    if (driverId) {
      await admin.from('erasure_log').delete().eq('subject_id', driverId);
      await admin.from('drivers').delete().eq('id', driverId);
    }
    if (userId) {
      await admin.from('memberships').delete().eq('user_id', userId);
      await admin.from('profiles').delete().eq('id', userId);
      await admin.auth.admin.deleteUser(userId).catch(() => {});
    }
  });

  it('2. authenticated users cannot execute erase_driver_pii', async () => {
    const { error } = await managerClient.rpc('erase_driver_pii', {
      p_driver_id: driverId,
      p_reason: 'should be denied',
    });
    expect(error).not.toBeNull();
    expect(error!.code).toBe('42501'); // permission denied for function
  });

  it('1. service_role erasure tombstones identity, keeps the ledger intact', async () => {
    const { data, error } = await admin.rpc('erase_driver_pii', {
      p_driver_id: driverId,
      p_reason: `test erasure ${RUN}`,
    });
    expect(error).toBeNull();
    expect(data.profile_id).toBe(userId);

    // Driver identity destroyed.
    const { data: d } = await admin
      .from('drivers')
      .select('name_ar, license_number, profile_id, status, absher_verified')
      .eq('id', driverId)
      .single<{ name_ar: string; license_number: string; profile_id: string | null; status: string; absher_verified: boolean }>();
    expect(d!.name_ar).toContain('محذوف');
    expect(d!.license_number.startsWith('REDACTED-')).toBe(true);
    expect(d!.profile_id).toBeNull();
    expect(d!.status).toBe('inactive');

    // Profile tombstoned (row survives), phone gone.
    const { data: p } = await admin
      .from('profiles')
      .select('name_ar, phone')
      .eq('id', userId)
      .single<{ name_ar: string; phone: string | null }>();
    expect(p!.name_ar).toBe('محذوف');
    expect(p!.phone).toBeNull();

    // Memberships gone.
    const { data: mems } = await admin.from('memberships').select('id').eq('user_id', userId);
    expect(mems ?? []).toHaveLength(0);

    // The ledger event SURVIVED with its lineage intact.
    const { data: ev } = await admin
      .from('pickup_events')
      .select('id, driver_id, created_by')
      .eq('id', eventId)
      .single<{ id: string; driver_id: string; created_by: string }>();
    expect(ev!.driver_id).toBe(driverId);
    expect(ev!.created_by).toBe(userId);

    // Accountability row exists.
    const { data: log } = await admin
      .from('erasure_log')
      .select('subject_id, profile_id, reason')
      .eq('subject_id', driverId)
      .single<{ subject_id: string; profile_id: string; reason: string }>();
    expect(log!.profile_id).toBe(userId);
    expect(log!.reason).toContain('test erasure');
  });

  it('3. authenticated users cannot read erasure_log', async () => {
    const { data, error } = await managerClient.from('erasure_log').select('id');
    // No grant at all → permission denied (not just empty-by-RLS).
    expect(error).not.toBeNull();
    expect(data).toBeNull();
  });

  it('4. erasure is idempotent', async () => {
    const { error } = await admin.rpc('erase_driver_pii', {
      p_driver_id: driverId,
      p_reason: 'second run',
    });
    expect(error).toBeNull();
  });
});
