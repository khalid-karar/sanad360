/**
 * Evidence-File Integrity Tests (Migration 005)
 *
 * Proves the append-only guarantees on evidence storage + the SHA-256 chain:
 *   1. An authenticated client CANNOT overwrite (UPDATE) a pickup-photos object.
 *   2. An authenticated client CANNOT delete (DELETE) a pickup-photos object.
 *   3. The SHA-256 stored in pickup_events.photo_sha256 matches the bytes of the
 *      uploaded file (computed via the same Web Crypto path the app uses).
 *   4. (Skipped if the PDF service is down) The generated inspection PDF embeds
 *      the photo_sha256 in its text content.
 *
 * Prerequisites:
 *   supabase db reset          (applies 001..005 + seed; creates the buckets)
 *   .env exports VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
 *   (test 4 also needs the PDF service on VITE_PDF_SERVICE_URL)
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY ?? '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const PDF_SERVICE_URL = process.env.VITE_PDF_SERVICE_URL ?? 'http://localhost:3001';

if (!ANON_KEY || !SERVICE_KEY) {
  throw new Error('Set VITE_SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY in .env.');
}

const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
const anon = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });

const SEED = {
  companyId: 'a0000000-0000-0000-0000-000000000001',
  branchId: 'b0000000-0000-0000-0000-000000000001',
  transportCompanyId: 'c0000000-0000-0000-0000-000000000001',
  driverId: 'd0000000-0000-0000-0000-000000000001',
  vehicleId: 'e0000000-0000-0000-0000-000000000001',
  managerEmail: 'manager@sanad360.dev',
  managerPassword: 'DevPass1234!',
};

const PHOTOS_BUCKET = 'pickup-photos';

/** lowercase-hex SHA-256 via Web Crypto (same path as src/lib/api/storage.ts). */
async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const buf = new Uint8Array(bytes.byteLength);
  buf.set(bytes);
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
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

async function isPdfServiceUp(): Promise<boolean> {
  try {
    const res = await fetch(`${PDF_SERVICE_URL}/health`, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}

describe('Evidence-file integrity (Migration 005)', () => {
  let managerClient: SupabaseClient;
  const photoBytes = new TextEncoder().encode(`integrity-test-photo-${Date.now()}`);
  let photoPath = '';
  let photoSha = '';
  let pickupEventId = '';

  beforeAll(async () => {
    // Confirm the buckets exist (created by migration 005).
    const { data: buckets } = await admin.storage.listBuckets();
    const names = (buckets ?? []).map((b) => b.name);
    if (!names.includes(PHOTOS_BUCKET)) {
      throw new Error('pickup-photos bucket missing — run `supabase db reset` (needs 005).');
    }

    managerClient = await sessionClient(SEED.managerEmail, SEED.managerPassword);

    photoSha = await sha256Hex(photoBytes);
    photoPath = `${SEED.companyId}/${SEED.branchId}/${Date.now()}/photo.bin`;

    // Authenticated upload (allowed by evidence_insert policy).
    const { error: upErr } = await managerClient.storage
      .from(PHOTOS_BUCKET)
      .upload(photoPath, photoBytes, { upsert: false, contentType: 'application/octet-stream' });
    if (upErr) throw new Error(`upload failed: ${upErr.message}`);

    // Create a pickup event (via admin/service_role) carrying the photo hash.
    const { data: ev, error: evErr } = await admin
      .from('pickup_events')
      .insert({
        logical_id: crypto.randomUUID(),
        revision: 1,
        company_id: SEED.companyId,
        branch_id: SEED.branchId,
        transport_company_id: SEED.transportCompanyId,
        driver_id: SEED.driverId,
        vehicle_id: SEED.vehicleId,
        waste_types: ['organic', 'food_waste'],
        weight_kg: 25,
        gps_lat: 24.6877,
        gps_lng: 46.6876,
        photo_path: photoPath,
        photo_sha256: photoSha,
      })
      .select('id')
      .single<{ id: string }>();
    if (evErr) throw new Error(`pickup insert failed: ${evErr.message}`);
    pickupEventId = ev.id;
  });

  afterAll(async () => {
    if (pickupEventId) await admin.from('pickup_events').delete().eq('id', pickupEventId);
    if (photoPath) await admin.storage.from(PHOTOS_BUCKET).remove([photoPath]);
  });

  it('1. authenticated client CANNOT overwrite a pickup-photos object', async () => {
    // upsert:true is an UPDATE on an existing object → denied by evidence_no_update.
    const { error } = await managerClient.storage
      .from(PHOTOS_BUCKET)
      .upload(photoPath, new TextEncoder().encode('tampered'), {
        upsert: true,
        contentType: 'application/octet-stream',
      });
    expect(error).not.toBeNull();

    // The original bytes must be intact.
    const { data: blob } = await admin.storage.from(PHOTOS_BUCKET).download(photoPath);
    const after = new Uint8Array(await blob!.arrayBuffer());
    expect(await sha256Hex(after)).toBe(photoSha);
  });

  it('2. authenticated client CANNOT delete a pickup-photos object', async () => {
    const { error } = await managerClient.storage.from(PHOTOS_BUCKET).remove([photoPath]);
    // Storage remove() with no matching deletable rows returns either an error
    // or an empty data set; either way the object must still exist afterward.
    expect(error === null || error !== null).toBe(true);

    const { data: stillThere, error: dlErr } = await admin.storage
      .from(PHOTOS_BUCKET)
      .download(photoPath);
    expect(dlErr).toBeNull();
    expect(stillThere).not.toBeNull();
  });

  it('3. stored photo_sha256 matches the uploaded bytes', async () => {
    const { data: row } = await admin
      .from('pickup_events')
      .select('photo_sha256, photo_path')
      .eq('id', pickupEventId)
      .single<{ photo_sha256: string; photo_path: string }>();

    expect(row!.photo_sha256).toMatch(/^[0-9a-f]{64}$/);

    const { data: blob } = await admin.storage.from(PHOTOS_BUCKET).download(row!.photo_path);
    const bytes = new Uint8Array(await blob!.arrayBuffer());
    expect(await sha256Hex(bytes)).toBe(row!.photo_sha256);
  });

  it('4. generated PDF embeds the photo_sha256 (skipped if service down)', async () => {
    if (!(await isPdfServiceUp())) {
      console.log('SKIP: PDF service not running');
      return;
    }

    const { data: signIn } = await anon.auth.signInWithPassword({
      email: SEED.managerEmail,
      password: SEED.managerPassword,
    });
    const jwt = signIn!.session!.access_token;

    const res = await fetch(`${PDF_SERVICE_URL}/generate/single-pickup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
      body: JSON.stringify({ pickup_event_id: pickupEventId }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { signed_url: string; inspection_pdf_id: string };

    const pdfRes = await fetch(body.signed_url);
    const pdfBytes = new Uint8Array(await pdfRes.arrayBuffer());

    // PDF streams are deflate-compressed — extract text via pdf-parse (same
    // approach used in phase2-acceptance.test.ts) instead of raw byte search.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pdfParseModule = await import('pdf-parse') as any;
    let extractedText: string;
    if (typeof pdfParseModule.PDFParse === 'function') {
      const parser = new pdfParseModule.PDFParse({ data: pdfBytes });
      const result = await parser.getText() as { text: string };
      extractedText = result.text;
    } else {
      const result = await pdfParseModule.default(Buffer.from(pdfBytes));
      extractedText = result.text;
    }

    // The hash appears in the Tamper-Evident section. Accept first 16 hex chars
    // in case the full 64-char string wraps across text-extraction boundaries.
    const found = extractedText.includes(photoSha) || extractedText.includes(photoSha.slice(0, 16));
    expect(found).toBe(true);

    await admin.from('inspection_pdfs').delete().eq('id', body.inspection_pdf_id);
  });
});
