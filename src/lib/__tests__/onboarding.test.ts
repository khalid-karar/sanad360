/**
 * Admin Onboarding Endpoint Tests (/admin/onboard-company)
 *
 * Regression coverage for the bug where the endpoint filtered memberships on a
 * nonexistent `status` column, which made the query error and EVERY caller —
 * including real admins — receive 403. The endpoint previously had zero test
 * coverage.
 *
 * Requires the PDF service to be running (it hosts the endpoint); tests are
 * skipped with a warning when it is down, mirroring inspection-pdf.test.ts.
 *
 * Assertions:
 *   1. Admin can onboard a company (201) and the owner membership exists
 *   2. Non-admin (company manager) gets 403
 *   3. Missing bearer token gets 403
 */

import { createClient } from '@supabase/supabase-js';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

const SUPABASE_URL    = process.env.VITE_SUPABASE_URL ?? 'http://localhost:54321';
const ANON_KEY        = process.env.VITE_SUPABASE_ANON_KEY ?? '';
const SERVICE_KEY     = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const PDF_SERVICE_URL = process.env.VITE_PDF_SERVICE_URL ?? 'http://localhost:3001';

if (!ANON_KEY || !SERVICE_KEY) {
  throw new Error(
    'Set VITE_SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY in .env before running tests.'
  );
}

const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
const anon  = createClient(SUPABASE_URL, ANON_KEY,    { auth: { persistSession: false } });

const SEED = {
  managerEmail:    'manager@sanad360.dev',
  managerPassword: 'DevPass1234!',
};

const RUN = Date.now();
const ADMIN_EMAIL    = `platform-admin-${RUN}@sanad360.dev`;
const ADMIN_PASSWORD = 'DevPass1234!';
const NEW_OWNER_EMAIL = `owner-${RUN}@sanad360.dev`;

async function jwtFor(email: string, password: string): Promise<string> {
  const { data, error } = await anon.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data.session!.access_token;
}

async function isPdfServiceUp(): Promise<boolean> {
  try {
    const res = await fetch(`${PDF_SERVICE_URL}/health`, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}

function postOnboard(body: unknown, jwt?: string): Promise<Response> {
  return fetch(`${PDF_SERVICE_URL}/admin/onboard-company`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

describe('Admin onboarding endpoint', () => {
  let serviceUp = false;
  let adminUserId = '';
  let createdCompanyId = '';
  let createdOwnerId = '';

  beforeAll(async () => {
    serviceUp = await isPdfServiceUp();
    if (!serviceUp) {
      // eslint-disable-next-line no-console
      console.warn(`[onboarding.test] PDF service not reachable at ${PDF_SERVICE_URL} — skipping.`);
      return;
    }
    // Platform admin: membership with role='admin' and NO tenant (one_tenant CHECK).
    const { data: created, error } = await admin.auth.admin.createUser({
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
      email_confirm: true,
      user_metadata: { name_ar: 'مشرف المنصة' },
    });
    if (error || !created.user) throw new Error(`admin createUser failed: ${error?.message}`);
    adminUserId = created.user.id;

    const { error: memErr } = await admin
      .from('memberships')
      .insert({ user_id: adminUserId, role: 'admin' });
    if (memErr) throw new Error(`admin membership failed: ${memErr.message}`);
  });

  afterAll(async () => {
    if (createdCompanyId) {
      await admin.from('company_transporters').delete().eq('company_id', createdCompanyId);
      await admin.from('memberships').delete().eq('company_id', createdCompanyId);
      await admin.from('companies').delete().eq('id', createdCompanyId);
    }
    if (createdOwnerId) {
      await admin.from('profiles').delete().eq('id', createdOwnerId);
      await admin.auth.admin.deleteUser(createdOwnerId);
    }
    if (adminUserId) {
      await admin.from('memberships').delete().eq('user_id', adminUserId);
      await admin.from('profiles').delete().eq('id', adminUserId);
      await admin.auth.admin.deleteUser(adminUserId);
    }
  });

  it('1. admin can onboard a company (201) with owner membership', async () => {
    if (!serviceUp) return;
    const jwt = await jwtFor(ADMIN_EMAIL, ADMIN_PASSWORD);
    const res = await postOnboard(
      {
        tenant_type: 'company',
        name_ar: `شركة اختبار الإدخال ${RUN}`,
        commercial_registration: `CR-ONB-${RUN}`,
        owner_email: NEW_OWNER_EMAIL,
        owner_temp_password: 'TempPass1234!',
        owner_name_ar: 'مالك تجريبي',
      },
      jwt
    );

    expect(res.status).toBe(201);
    const json = (await res.json()) as { companyId: string; userId: string };
    expect(json.companyId).toBeTruthy();
    expect(json.userId).toBeTruthy();
    createdCompanyId = json.companyId;
    createdOwnerId = json.userId;

    // Owner membership actually exists and points at the new company.
    const { data: mem } = await admin
      .from('memberships')
      .select('role, company_id')
      .eq('user_id', json.userId)
      .single<{ role: string; company_id: string }>();
    expect(mem?.role).toBe('owner');
    expect(mem?.company_id).toBe(json.companyId);
  });

  it('2. non-admin caller gets 403', async () => {
    if (!serviceUp) return;
    const jwt = await jwtFor(SEED.managerEmail, SEED.managerPassword);
    const res = await postOnboard(
      {
        tenant_type: 'company',
        name_ar: 'يجب ألا تُنشأ',
        commercial_registration: `CR-DENY-${RUN}`,
        owner_email: `deny-${RUN}@sanad360.dev`,
        owner_temp_password: 'TempPass1234!',
      },
      jwt
    );
    expect(res.status).toBe(403);
  });

  it('3. missing bearer token gets 403', async () => {
    if (!serviceUp) return;
    const res = await postOnboard({ tenant_type: 'company' });
    expect(res.status).toBe(403);
  });
});
