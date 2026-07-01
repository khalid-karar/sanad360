/**
 * Storage Tenant Isolation Tests (Migration 008)
 *
 * Verifies the fix for the cross-tenant storage leak: migration 005's
 * evidence_select/evidence_insert allowed ANY authenticated user to read and
 * write ALL objects in the evidence + inspection-pdfs buckets. Migration 008
 * scopes every operation to the {company_id}/ path prefix via
 * public.storage_company_prefix_allowed().
 *
 * Run against a local Supabase instance: `supabase start` then `npm test`.
 * All access-control assertions run as REAL signed-in users (anon key + JWT);
 * service_role is used only for setup/teardown.
 *
 * Assertions:
 *   1. Outsider (company B manager) CANNOT download company A evidence
 *   2. Outsider CANNOT list company A's evidence prefix
 *   3. Outsider CANNOT create a signed URL for company A evidence
 *   4. Outsider CANNOT upload into company A's prefix (path squatting)
 *   5. Outsider CANNOT download company A's inspection PDFs
 *   6. Company A manager CAN download own evidence
 *   7. Linked transporter driver CAN download company A evidence
 *   8. Transport-side user CANNOT read inspection PDFs (company/admin only)
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

// ─── Seed IDs (must match supabase/seed.sql) ─────────────────────────────────
const SEED = {
  companyId:       'a0000000-0000-0000-0000-000000000001',
  branchId:        'b0000000-0000-0000-0000-000000000001',
  managerEmail:    'manager@sanad360.dev',
  managerPassword: 'DevPass1234!',
  driverEmail:     '0501234567@driver.sanad360.com',
  driverPassword:  'DevPass1234!',
};

const PHOTOS_BUCKET = 'pickup-photos';
const PDFS_BUCKET   = 'inspection-pdfs';

const RUN = Date.now();
const OUTSIDER_EMAIL = `outsider-${RUN}@sanad360.dev`;
const OUTSIDER_PASSWORD = 'DevPass1234!';

async function sessionClient(email: string, password: string): Promise<SupabaseClient> {
  const { data, error } = await anon.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${data.session!.access_token}` } },
  });
}

describe('Storage tenant isolation (Migration 008)', () => {
  const evidenceBytes = new TextEncoder().encode(`isolation-photo-${RUN}`);
  const pdfBytes      = new TextEncoder().encode(`%PDF-1.4 isolation-${RUN}`);
  const evidencePath  = `${SEED.companyId}/${SEED.branchId}/isolation-${RUN}/photo.bin`;
  const pdfPath       = `${SEED.companyId}/${SEED.branchId}/isolation-${RUN}.pdf`;

  let outsiderUserId = '';
  let outsiderCompanyId = '';
  let outsiderClient: SupabaseClient;
  let managerClient: SupabaseClient;
  let driverClient: SupabaseClient;

  beforeAll(async () => {
    // Fixture objects in company A's prefixes (service_role bypasses RLS).
    const { error: upErr } = await admin.storage
      .from(PHOTOS_BUCKET)
      .upload(evidencePath, evidenceBytes, { upsert: false, contentType: 'application/octet-stream' });
    if (upErr) throw new Error(`fixture evidence upload failed: ${upErr.message}`);

    const { error: pdfErr } = await admin.storage
      .from(PDFS_BUCKET)
      .upload(pdfPath, pdfBytes, { upsert: false, contentType: 'application/pdf' });
    if (pdfErr) throw new Error(`fixture pdf upload failed: ${pdfErr.message}`);

    // Outsider tenant: company B with its own manager, NOT linked to anything.
    const { data: c2, error: c2Err } = await admin
      .from('companies')
      .insert({ name_ar: `شركة العزل ${RUN}`, commercial_registration: `CR-ISO-${RUN}` })
      .select('id')
      .single<{ id: string }>();
    if (c2Err || !c2) throw new Error(`company B insert failed: ${c2Err?.message}`);
    outsiderCompanyId = c2.id;

    const { data: created, error: userErr } = await admin.auth.admin.createUser({
      email: OUTSIDER_EMAIL,
      password: OUTSIDER_PASSWORD,
      email_confirm: true,
      user_metadata: { name_ar: 'مدير خارجي' },
    });
    if (userErr || !created.user) throw new Error(`outsider createUser failed: ${userErr?.message}`);
    outsiderUserId = created.user.id;

    const { error: memErr } = await admin.from('memberships').insert({
      user_id: outsiderUserId,
      role: 'manager',
      company_id: outsiderCompanyId,
    });
    if (memErr) throw new Error(`outsider membership failed: ${memErr.message}`);

    [outsiderClient, managerClient, driverClient] = await Promise.all([
      sessionClient(OUTSIDER_EMAIL, OUTSIDER_PASSWORD),
      sessionClient(SEED.managerEmail, SEED.managerPassword),
      sessionClient(SEED.driverEmail, SEED.driverPassword),
    ]);
  });

  afterAll(async () => {
    await admin.storage.from(PHOTOS_BUCKET).remove([evidencePath]);
    await admin.storage.from(PDFS_BUCKET).remove([pdfPath]);
    if (outsiderUserId) {
      await admin.from('memberships').delete().eq('user_id', outsiderUserId);
      await admin.from('profiles').delete().eq('id', outsiderUserId);
      await admin.auth.admin.deleteUser(outsiderUserId);
    }
    if (outsiderCompanyId) {
      await admin.from('companies').delete().eq('id', outsiderCompanyId);
    }
  });

  it("1. outsider CANNOT download another company's evidence", async () => {
    const { data, error } = await outsiderClient.storage
      .from(PHOTOS_BUCKET)
      .download(evidencePath);
    expect(data).toBeNull();
    expect(error).not.toBeNull();
  });

  it("2. outsider CANNOT list another company's evidence prefix", async () => {
    const { data } = await outsiderClient.storage
      .from(PHOTOS_BUCKET)
      .list(`${SEED.companyId}/${SEED.branchId}/isolation-${RUN}`);
    // Under RLS, list() of an invisible prefix returns an empty array.
    expect(data ?? []).toHaveLength(0);
  });

  it("3. outsider CANNOT create a signed URL for another company's evidence", async () => {
    const { data, error } = await outsiderClient.storage
      .from(PHOTOS_BUCKET)
      .createSignedUrl(evidencePath, 60);
    expect(data).toBeNull();
    expect(error).not.toBeNull();
  });

  it("4. outsider CANNOT upload into another company's prefix", async () => {
    const squatPath = `${SEED.companyId}/${SEED.branchId}/squat-${RUN}/photo.bin`;
    const { error } = await outsiderClient.storage
      .from(PHOTOS_BUCKET)
      .upload(squatPath, evidenceBytes, { upsert: false });
    expect(error).not.toBeNull();
    // Belt-and-suspenders: confirm nothing landed.
    const { data } = await admin.storage
      .from(PHOTOS_BUCKET)
      .list(`${SEED.companyId}/${SEED.branchId}/squat-${RUN}`);
    expect(data ?? []).toHaveLength(0);
  });

  it("5. outsider CANNOT download another company's inspection PDF", async () => {
    const { data, error } = await outsiderClient.storage
      .from(PDFS_BUCKET)
      .download(pdfPath);
    expect(data).toBeNull();
    expect(error).not.toBeNull();
  });

  it('6. company member CAN download own evidence', async () => {
    const { data, error } = await managerClient.storage
      .from(PHOTOS_BUCKET)
      .download(evidencePath);
    expect(error).toBeNull();
    expect(data).not.toBeNull();
    const text = await data!.text();
    expect(text).toBe(`isolation-photo-${RUN}`);
  });

  it('7. linked transporter driver CAN download the serviced company evidence', async () => {
    // Seed links transport company C1 to company A via company_transporters.
    const { data, error } = await driverClient.storage
      .from(PHOTOS_BUCKET)
      .download(evidencePath);
    expect(error).toBeNull();
    expect(data).not.toBeNull();
  });

  it('8. transport-side user CANNOT read inspection PDFs', async () => {
    const { data, error } = await driverClient.storage
      .from(PDFS_BUCKET)
      .download(pdfPath);
    expect(data).toBeNull();
    expect(error).not.toBeNull();
  });
});
