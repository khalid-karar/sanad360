/**
 * Product backlog features (Migration 016)
 *
 *   1. Recurring assignments: completing a weekly assignment spawns the next
 *      occurrence (+7d, pending, same driver/vehicle/creator); the series
 *      STOPS once the next occurrence would pass recurrence_until
 *   2. PDPL erasure clears the new drivers.phone (WhatsApp) field
 *   3. Company-wide monthly pack endpoint renders and records a
 *      report_type='monthly_company' inspection_pdfs row (skips if the PDF
 *      service is down)
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

const SUPABASE_URL    = process.env.VITE_SUPABASE_URL ?? 'http://localhost:54321';
const ANON_KEY        = process.env.VITE_SUPABASE_ANON_KEY ?? '';
const SERVICE_KEY     = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const PDF_SERVICE_URL = process.env.VITE_PDF_SERVICE_URL ?? 'http://localhost:3001';

if (!ANON_KEY || !SERVICE_KEY) {
  throw new Error('Set VITE_SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY in .env first.');
}

const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
const anon  = createClient(SUPABASE_URL, ANON_KEY,    { auth: { persistSession: false } });

const SEED = {
  companyId:          'a0000000-0000-0000-0000-000000000001',
  branchId:           'b0000000-0000-0000-0000-000000000001',
  transportCompanyId: 'c0000000-0000-0000-0000-000000000001',
  driverId:           'd0000000-0000-0000-0000-000000000001',
  vehicleId:          'e0000000-0000-0000-0000-000000000001',
  driverProfileId:    'f0000000-0000-0000-0000-000000000002',
  managerEmail:       'manager@sanad360.dev',
  password:           'DevPass1234!',
};

const RUN = Date.now();
const TAG = `backlog-${RUN}`;

async function sessionClient(email: string): Promise<SupabaseClient> {
  const { data, error } = await anon.auth.signInWithPassword({ email, password: SEED.password });
  if (error) throw error;
  return createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${data.session!.access_token}` } },
  });
}

async function isPdfServiceUp(): Promise<boolean> {
  try {
    const res = await fetch(`${PDF_SERVICE_URL}/health`, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}

describe('Product backlog (Migration 016)', () => {
  let manager: SupabaseClient;
  let managerJwt = '';
  let phoneDriverId = '';
  let packPdfId = '';

  beforeAll(async () => {
    manager = await sessionClient(SEED.managerEmail);
    const { data } = await anon.auth.signInWithPassword({
      email: SEED.managerEmail,
      password: SEED.password,
    });
    managerJwt = data.session!.access_token;
  });

  afterAll(async () => {
    // Series assignments are tagged in notes for reliable cleanup.
    await admin.from('pickup_assignments').delete().like('notes', `%${TAG}%`);
    await admin.from('notifications').delete().eq('profile_id', SEED.driverProfileId);
    if (phoneDriverId) {
      await admin.from('erasure_log').delete().eq('subject_id', phoneDriverId);
      await admin.from('drivers').delete().eq('id', phoneDriverId);
    }
    if (packPdfId) await admin.from('inspection_pdfs').delete().eq('id', packPdfId);
  });

  it('1. weekly recurrence spawns the next occurrence, then stops at the horizon', async () => {
    const start = new Date();
    // until = +10 days: occurrence 2 (+7d) fits, occurrence 3 (+14d) must NOT spawn.
    const until = new Date(start.getTime() + 10 * 86400000).toISOString().slice(0, 10);

    const { data: a1, error } = await manager
      .from('pickup_assignments')
      .insert({
        company_id: SEED.companyId,
        branch_id: SEED.branchId,
        driver_id: SEED.driverId,
        vehicle_id: SEED.vehicleId,
        scheduled_at: start.toISOString(),
        recurrence: 'weekly',
        recurrence_until: until,
        notes: TAG,
      })
      .select('id, scheduled_at')
      .single<{ id: string; scheduled_at: string }>();
    expect(error).toBeNull();

    // Complete it (service_role keeps the test focused on the trigger).
    await admin.from('pickup_assignments').update({ status: 'completed' }).eq('id', a1!.id);

    const { data: series1 } = await admin
      .from('pickup_assignments')
      .select('id, status, scheduled_at, recurrence')
      .like('notes', `%${TAG}%`)
      .order('scheduled_at', { ascending: true });
    expect(series1).toHaveLength(2);
    const next = series1![1];
    expect(next.status).toBe('pending');
    expect(next.recurrence).toBe('weekly');
    const deltaDays =
      (new Date(next.scheduled_at).getTime() - new Date(a1!.scheduled_at).getTime()) / 86400000;
    expect(Math.round(deltaDays)).toBe(7);

    // Completing occurrence 2: its successor (+14d) exceeds `until` → no spawn.
    await admin.from('pickup_assignments').update({ status: 'completed' }).eq('id', next.id);
    const { data: series2 } = await admin
      .from('pickup_assignments')
      .select('id')
      .like('notes', `%${TAG}%`);
    expect(series2).toHaveLength(2);
  });

  it('2. PDPL erasure clears drivers.phone', async () => {
    const { data: d } = await admin
      .from('drivers')
      .insert({
        transport_company_id: SEED.transportCompanyId,
        name_ar: 'سائق بجوال',
        phone: '0551112233',
        license_number: `PH-${RUN}`,
        license_expiry: '2030-01-01',
      })
      .select('id')
      .single<{ id: string }>();
    phoneDriverId = d!.id;

    const { error } = await admin.rpc('erase_driver_pii', {
      p_driver_id: phoneDriverId,
      p_reason: TAG,
    });
    expect(error).toBeNull();

    const { data: after } = await admin
      .from('drivers')
      .select('phone, name_ar')
      .eq('id', phoneDriverId)
      .single<{ phone: string | null; name_ar: string }>();
    expect(after!.phone).toBeNull();
    expect(after!.name_ar).toContain('محذوف');
  });

  it('3. company-wide monthly pack renders and records monthly_company', async () => {
    if (!(await isPdfServiceUp())) {
      console.warn('[product-backlog] PDF service down — skipping pack test.');
      return;
    }
    const month = new Date().toISOString().slice(0, 7);
    const res = await fetch(`${PDF_SERVICE_URL}/generate/monthly-company`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${managerJwt}` },
      body: JSON.stringify({ month }),
    });
    expect(res.ok).toBe(true);
    const json = (await res.json()) as {
      inspection_pdf_id: string;
      sha256_hash: string;
      branches: number;
    };
    packPdfId = json.inspection_pdf_id;
    expect(json.sha256_hash).toHaveLength(64);
    expect(json.branches).toBeGreaterThanOrEqual(1);

    const { data: row } = await admin
      .from('inspection_pdfs')
      .select('report_type, branch_id')
      .eq('id', packPdfId)
      .single<{ report_type: string; branch_id: string | null }>();
    expect(row!.report_type).toBe('monthly_company');
    expect(row!.branch_id).toBeNull();
  });
});
