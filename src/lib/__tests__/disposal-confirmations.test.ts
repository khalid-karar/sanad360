/**
 * Disposal Confirmations (Migration 010) — chain-of-custody leg
 *
 * The driver confirms delivery at the receiving facility; the confirmation is
 * append-only and tenant fields are server-set from the referenced ledger
 * event. All assertions run as REAL signed-in users; service_role is used for
 * setup/teardown only.
 *
 * Assertions:
 *   1. Driver records a confirmation (ticket uploaded + hashed); the trigger
 *      FORCES company/branch/transport fields from the event, ignoring spoofed
 *      client values, and forces created_by = auth.uid()
 *   2. One confirmation per event (UNIQUE) — a second insert fails
 *   3. UPDATE and DELETE are rejected for authenticated (append-only)
 *   4. Tenant isolation: an unrelated company's manager sees 0 rows;
 *      company A's manager sees the confirmation
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

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
  driverId:           'd0000000-0000-0000-0000-000000000001',
  vehicleId:          'e0000000-0000-0000-0000-000000000001',
  managerEmail:       'manager@sanad360.dev',
  managerPassword:    'DevPass1234!',
  driverEmail:        '0501234567@driver.sanad360.com',
  driverPassword:     'DevPass1234!',
};

const RUN = Date.now();
const OUTSIDER_EMAIL = `disposal-outsider-${RUN}@sanad360.dev`;

async function sessionClient(email: string, password: string): Promise<SupabaseClient> {
  const { data, error } = await anon.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${data.session!.access_token}` } },
  });
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const buf = new Uint8Array(bytes.byteLength);
  buf.set(bytes);
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

describe('Disposal confirmations (Migration 010)', () => {
  let driverClient: SupabaseClient;
  let managerClient: SupabaseClient;
  let outsiderClient: SupabaseClient;
  let outsiderUserId = '';
  let outsiderCompanyId = '';
  let eventId = '';
  let confirmationId = '';
  let ticketPath = '';
  let driverUserId = '';

  beforeAll(async () => {
    [driverClient, managerClient] = await Promise.all([
      sessionClient(SEED.driverEmail, SEED.driverPassword),
      sessionClient(SEED.managerEmail, SEED.managerPassword),
    ]);

    const { data: { user } } = await driverClient.auth.getUser();
    driverUserId = user?.id ?? '';

    // Ledger event the disposal confirms (driver-inserted, real RLS).
    const { data: ev, error: evErr } = await driverClient
      .from('pickup_events')
      .insert({
        logical_id: crypto.randomUUID(),
        revision: 1,
        company_id: SEED.companyId,
        branch_id: SEED.branchId,
        transport_company_id: SEED.transportCompanyId,
        driver_id: SEED.driverId,
        vehicle_id: SEED.vehicleId,
        waste_types: ['organic'],
        weight_kg: 18,
      })
      .select('id')
      .single<{ id: string }>();
    if (evErr || !ev) throw new Error(`event insert failed: ${evErr?.message}`);
    eventId = ev.id;

    // Outsider tenant (company B manager) for the isolation assertion.
    const { data: c2 } = await admin
      .from('companies')
      .insert({ name_ar: `شركة عزل التسليم ${RUN}`, commercial_registration: `CR-DIS-${RUN}` })
      .select('id')
      .single<{ id: string }>();
    outsiderCompanyId = c2!.id;
    const { data: created } = await admin.auth.admin.createUser({
      email: OUTSIDER_EMAIL,
      password: 'DevPass1234!',
      email_confirm: true,
    });
    outsiderUserId = created.user!.id;
    await admin.from('memberships').insert({
      user_id: outsiderUserId,
      role: 'manager',
      company_id: outsiderCompanyId,
    });
    outsiderClient = await sessionClient(OUTSIDER_EMAIL, 'DevPass1234!');
  });

  afterAll(async () => {
    if (confirmationId) await admin.from('disposal_confirmations').delete().eq('id', confirmationId);
    if (eventId) await admin.from('pickup_events').delete().eq('id', eventId);
    if (ticketPath) await admin.storage.from('disposal-tickets').remove([ticketPath]);
    if (outsiderUserId) {
      await admin.from('memberships').delete().eq('user_id', outsiderUserId);
      await admin.from('profiles').delete().eq('id', outsiderUserId);
      await admin.auth.admin.deleteUser(outsiderUserId);
    }
    if (outsiderCompanyId) await admin.from('companies').delete().eq('id', outsiderCompanyId);
  });

  it('1. driver records a confirmation; server forces tenant fields + created_by', async () => {
    const ticketBytes = new TextEncoder().encode(`weighbridge-${RUN}`);
    const ticketSha = await sha256Hex(ticketBytes);
    ticketPath = `${SEED.companyId}/${SEED.branchId}/${eventId}/ticket.bin`;

    const { error: upErr } = await driverClient.storage
      .from('disposal-tickets')
      .upload(ticketPath, ticketBytes, { upsert: false, contentType: 'application/octet-stream' });
    expect(upErr).toBeNull();

    const { data, error } = await driverClient
      .from('disposal_confirmations')
      .insert({
        pickup_event_id: eventId,
        // Spoofed tenant fields — the BEFORE INSERT trigger must overwrite
        // them with the referenced event's values.
        company_id: '00000000-0000-0000-0000-00000000dead',
        branch_id: SEED.branchId,
        transport_company_id: '00000000-0000-0000-0000-00000000beef',
        created_by: '00000000-0000-0000-0000-00000000cafe',
        facility_name_ar: 'منشأة معالجة الرياض',
        facility_license_number: 'MWAN-12345',
        ticket_path: ticketPath,
        ticket_sha256: ticketSha,
        gps_lat: 24.9,
        gps_lng: 46.7,
      })
      .select('*')
      .single<{
        id: string;
        company_id: string;
        transport_company_id: string;
        created_by: string;
        ticket_sha256: string;
      }>();

    expect(error).toBeNull();
    confirmationId = data!.id;
    expect(data!.company_id).toBe(SEED.companyId);
    expect(data!.transport_company_id).toBe(SEED.transportCompanyId);
    expect(data!.created_by).toBe(driverUserId);
    expect(data!.ticket_sha256).toBe(ticketSha);
  });

  it('2. one confirmation per event — duplicate insert rejected', async () => {
    const { error } = await driverClient
      .from('disposal_confirmations')
      .insert({ pickup_event_id: eventId, facility_name_ar: 'مكرر' });
    expect(error).not.toBeNull();
  });

  it('3. UPDATE and DELETE are rejected for authenticated (append-only)', async () => {
    const { error: updErr } = await driverClient
      .from('disposal_confirmations')
      .update({ facility_name_ar: 'عبث' })
      .eq('id', confirmationId);
    expect(updErr).not.toBeNull();

    const { error: delErr, count } = await driverClient
      .from('disposal_confirmations')
      .delete({ count: 'exact' })
      .eq('id', confirmationId);
    // Either an explicit permission error or 0 rows affected is acceptable proof.
    expect(delErr !== null || count === 0 || count === null).toBe(true);

    const { data: still } = await admin
      .from('disposal_confirmations')
      .select('id, facility_name_ar')
      .eq('id', confirmationId)
      .single<{ id: string; facility_name_ar: string }>();
    expect(still?.facility_name_ar).toBe('منشأة معالجة الرياض');
  });

  it('4. tenant isolation: outsider sees 0 rows; company A manager sees it', async () => {
    const { data: outsiderRows } = await outsiderClient
      .from('disposal_confirmations')
      .select('id')
      .eq('id', confirmationId);
    expect(outsiderRows ?? []).toHaveLength(0);

    const { data: managerRow, error } = await managerClient
      .from('disposal_confirmations')
      .select('id, facility_name_ar')
      .eq('id', confirmationId)
      .single<{ id: string; facility_name_ar: string }>();
    expect(error).toBeNull();
    expect(managerRow?.facility_name_ar).toBe('منشأة معالجة الرياض');
  });
});
