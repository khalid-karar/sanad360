/**
 * Branch QR issuer endpoint (services/pdf POST /branches/:branchId/qr)
 *
 * Migration 022/Part B: branches.qr_token is a server-only HMAC secret; the
 * only way any client ever gets a scannable value is this short-TTL (90s)
 * signed token. HARD-fails in beforeAll if the PDF service isn't reachable
 * (CP8 Slice I — no more soft-skip; see testHelpers/pdfServiceCheck.ts).
 *
 * Assertions:
 *   1. Owner/manager of the branch's own company → 200 with {token, expires_at}
 *   2. A member of a DIFFERENT company → 403 (tenant mismatch)
 *   3. A driver-role caller → 403 (only owner/manager, or admin, may issue)
 *   4. The issued token actually verifies server-side: inserting a
 *      pickup_event with it sets qr_verified=true
 *   5. A tampered token (flipped signature byte) fails verification
 *   6. (CP5) A branch_operator scoped to this exact branch → 200
 *   7. (CP5) A branch_operator scoped to a DIFFERENT branch → 403
 */

import { createClient } from '@supabase/supabase-js';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { assertPdfServiceUp } from './testHelpers/pdfServiceCheck';

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
  driverEmail: '0501234567@driver.sanad360.com',
  driverPassword: 'DevPass1234!',
};

const RUN = Date.now();

async function signIn(email: string, password: string): Promise<string> {
  const { data, error } = await anon.auth.signInWithPassword({ email, password });
  if (error || !data.session) throw new Error(`sign-in failed (${email}): ${error?.message}`);
  return data.session.access_token;
}

interface IssuedBranchQr {
  token: string;
  expires_at: string;
}

async function issueQr(jwt: string, branchId: string): Promise<Response> {
  return fetch(`${PDF_SERVICE_URL}/branches/${branchId}/qr`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
  });
}

describe('Branch QR issuer (services/pdf, Migration 022/Part B)', () => {
  let managerJwt = '';
  let driverJwt = '';
  let driverUserId = '';
  let outsiderJwt = '';
  let outsiderCompanyId = '';
  let outsiderUserId = '';
  let branchOperatorJwt = '';
  let branchOperatorUserId = '';
  let otherBranchOperatorJwt = '';
  let otherBranchOperatorUserId = '';
  let otherBranchId = '';
  let dispatcherJwt = '';
  let dispatcherUserId = '';
  let consultantJwt = '';
  let consultantUserId = '';
  const cleanupEventIds: string[] = [];

  beforeAll(async () => {
    await assertPdfServiceUp(PDF_SERVICE_URL);

    managerJwt = await signIn(SEED.managerEmail, SEED.managerPassword);

    // CP8 Slice H: a dedicated, per-run driver account — NOT the globally
    // shared seed driver (0501234567@driver.sanad360.com). That shared
    // credential is signed into directly by 13+ other test files; some of
    // them call `.signOut()` with the default (global) scope, which revokes
    // EVERY session for that user, not just the caller's own — including a
    // JWT this file already captured in an earlier beforeAll. Confirmed via
    // direct diagnosis: the resulting 401 here was never a thrown exception
    // or a transient network failure (that failure mode IS real and is now
    // separately fixed in authMiddleware's bounded retry) — it was a genuine
    // AuthSessionMissingError ("session_not_found"), i.e. GoTrue correctly
    // reporting that this exact session had been revoked out from under it.
    // grant-audit.test.ts's own comment already documents this exact class
    // of bug and fixes it with per-email isolated clients; every OTHER role
    // in this file (outsider/branch_operator/dispatcher/consultant) already
    // gets its own fresh, per-run account — the driver was the one exception.
    const { data: driverCreated } = await admin.auth.admin.createUser({
      email: `branch-qr-driver-${RUN}@driver.sanad360.dev`,
      password: 'DevPass1234!',
      email_confirm: true,
    });
    driverUserId = driverCreated.user!.id;
    await admin.from('memberships').insert({
      user_id: driverUserId,
      role: 'driver',
      transport_company_id: SEED.transportCompanyId,
    });
    driverJwt = await signIn(`branch-qr-driver-${RUN}@driver.sanad360.dev`, 'DevPass1234!');

    // An owner/manager of a completely unrelated company (tenant mismatch case).
    const { data: company } = await admin
      .from('companies')
      .insert({ name_ar: 'شركة خارجية', commercial_registration: `BQR-${RUN}` })
      .select('id')
      .single<{ id: string }>();
    outsiderCompanyId = company!.id;

    const { data: created } = await admin.auth.admin.createUser({
      email: `branch-qr-outsider-${RUN}@company.sanad360.dev`,
      password: 'DevPass1234!',
      email_confirm: true,
    });
    outsiderUserId = created.user!.id;
    await admin.from('memberships').insert({
      user_id: outsiderUserId,
      role: 'owner',
      company_id: outsiderCompanyId,
    });
    outsiderJwt = await signIn(`branch-qr-outsider-${RUN}@company.sanad360.dev`, 'DevPass1234!');

    // A branch_operator scoped to SEED.branchId itself.
    const { data: boCreated } = await admin.auth.admin.createUser({
      email: `branch-qr-operator-${RUN}@company.sanad360.dev`,
      password: 'DevPass1234!',
      email_confirm: true,
    });
    branchOperatorUserId = boCreated.user!.id;
    await admin.from('memberships').insert({
      user_id: branchOperatorUserId,
      role: 'branch_operator',
      company_id: SEED.companyId,
      branch_id: SEED.branchId,
    });
    branchOperatorJwt = await signIn(`branch-qr-operator-${RUN}@company.sanad360.dev`, 'DevPass1234!');

    // A SECOND branch_operator scoped to a DIFFERENT branch under the same
    // company — proves the branch_operator carve-out is scoped to their own
    // branch_id, not their company.
    const { data: otherBranch } = await admin
      .from('branches')
      .insert({ company_id: SEED.companyId, name_ar: `فرع آخر ${RUN}` })
      .select('id')
      .single<{ id: string }>();
    otherBranchId = otherBranch!.id;

    const { data: otherBoCreated } = await admin.auth.admin.createUser({
      email: `branch-qr-other-operator-${RUN}@company.sanad360.dev`,
      password: 'DevPass1234!',
      email_confirm: true,
    });
    otherBranchOperatorUserId = otherBoCreated.user!.id;
    await admin.from('memberships').insert({
      user_id: otherBranchOperatorUserId,
      role: 'branch_operator',
      company_id: SEED.companyId,
      branch_id: otherBranchId,
    });
    otherBranchOperatorJwt = await signIn(`branch-qr-other-operator-${RUN}@company.sanad360.dev`, 'DevPass1234!');

    // A dispatcher of the SAME company (a role that DOES get write access to
    // other branch-adjacent resources, e.g. pickup scheduling — proving it
    // is NOT also admitted here matters more than an arbitrary role).
    const { data: dispatcherCreated } = await admin.auth.admin.createUser({
      email: `branch-qr-dispatcher-${RUN}@company.sanad360.dev`,
      password: 'DevPass1234!',
      email_confirm: true,
    });
    dispatcherUserId = dispatcherCreated.user!.id;
    await admin.from('memberships').insert({
      user_id: dispatcherUserId,
      role: 'dispatcher',
      company_id: SEED.companyId,
    });
    dispatcherJwt = await signIn(`branch-qr-dispatcher-${RUN}@company.sanad360.dev`, 'DevPass1234!');

    // A consultant (CP5) engaged with the SAME company — read-adjacent role,
    // not a signing authority for this endpoint.
    const { data: consultantCreated } = await admin.auth.admin.createUser({
      email: `branch-qr-consultant-${RUN}@company.sanad360.dev`,
      password: 'DevPass1234!',
      email_confirm: true,
    });
    consultantUserId = consultantCreated.user!.id;
    await admin.from('memberships').insert({
      user_id: consultantUserId,
      role: 'consultant',
      company_id: SEED.companyId,
    });
    consultantJwt = await signIn(`branch-qr-consultant-${RUN}@company.sanad360.dev`, 'DevPass1234!');
  });

  afterAll(async () => {
    if (cleanupEventIds.length) await admin.from('pickup_events').delete().in('id', cleanupEventIds);
    if (outsiderUserId) {
      await admin.from('memberships').delete().eq('user_id', outsiderUserId);
      await admin.from('profiles').delete().eq('id', outsiderUserId);
      await admin.auth.admin.deleteUser(outsiderUserId);
    }
    if (outsiderCompanyId) await admin.from('companies').delete().eq('id', outsiderCompanyId);
    for (const uid of [branchOperatorUserId, otherBranchOperatorUserId, dispatcherUserId, consultantUserId, driverUserId]) {
      if (!uid) continue;
      await admin.from('memberships').delete().eq('user_id', uid);
      await admin.from('profiles').delete().eq('id', uid);
      await admin.auth.admin.deleteUser(uid).catch(() => {});
    }
    if (otherBranchId) await admin.from('branches').delete().eq('id', otherBranchId);
  });

  it('1. manager of the branch\'s own company gets a signed token', async () => {
    const res = await issueQr(managerJwt, SEED.branchId);
    expect(res.status).toBe(200);
    const body = (await res.json()) as IssuedBranchQr;
    expect(body.token).toMatch(/^[A-Za-z0-9+/=]+\.[A-Za-z0-9+/=]+$/);
    const expiresInMs = new Date(body.expires_at).getTime() - Date.now();
    expect(expiresInMs).toBeGreaterThan(0);
    expect(expiresInMs).toBeLessThanOrEqual(91_000);
  });

  it('2. a member of a different company is rejected with 403', async () => {
    const res = await issueQr(outsiderJwt, SEED.branchId);
    expect(res.status).toBe(403);
  });

  it('3. a driver-role caller is rejected with 403', async () => {
    const res = await issueQr(driverJwt, SEED.branchId);
    expect(res.status).toBe(403);
  });

  it('4. the issued token verifies server-side (qr_verified=true on insert)', async () => {
    const res = await issueQr(managerJwt, SEED.branchId);
    expect(res.status).toBe(200);
    const { token } = (await res.json()) as IssuedBranchQr;

    const { data, error } = await admin
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
        weight_kg: 10,
        photo_path: 'p/photo.jpg',
        signature_path: 'p/sig.png',
        qr_code_value: token,
      })
      .select('id, qr_verified, risk_flags')
      .single<{ id: string; qr_verified: boolean; risk_flags: string[] }>();

    expect(error).toBeNull();
    cleanupEventIds.push(data!.id);
    expect(data!.qr_verified).toBe(true);
    expect(data!.risk_flags).not.toContain('qr_mismatch');
  });

  it('5. a tampered signature fails verification', async () => {
    const res = await issueQr(managerJwt, SEED.branchId);
    const { token } = (await res.json()) as IssuedBranchQr;
    const [payloadB64, sigB64] = token.split('.');
    // Flip the last character of the signature — still valid base64 shape,
    // wrong bytes.
    const tamperedSig =
      sigB64.slice(0, -1) + (sigB64.at(-1) === 'A' ? 'B' : 'A');
    const tampered = `${payloadB64}.${tamperedSig}`;

    const { data, error } = await admin
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
        weight_kg: 10,
        photo_path: 'p/photo.jpg',
        signature_path: 'p/sig.png',
        qr_code_value: tampered,
      })
      .select('id, qr_verified, risk_flags')
      .single<{ id: string; qr_verified: boolean; risk_flags: string[] }>();

    expect(error).toBeNull();
    cleanupEventIds.push(data!.id);
    expect(data!.qr_verified).toBe(false);
    expect(data!.risk_flags).toContain('qr_mismatch');
  });

  it('6. (CP5) a branch_operator scoped to this exact branch gets a signed token', async () => {
    const res = await issueQr(branchOperatorJwt, SEED.branchId);
    expect(res.status).toBe(200);
    const body = (await res.json()) as IssuedBranchQr;
    expect(body.token).toMatch(/^[A-Za-z0-9+/=]+\.[A-Za-z0-9+/=]+$/);
  });

  it('7. (CP5) a branch_operator scoped to a DIFFERENT branch is rejected with 403', async () => {
    const res = await issueQr(otherBranchOperatorJwt, SEED.branchId);
    expect(res.status).toBe(403);
  });

  it('8. (CP5) a dispatcher of the SAME company is rejected with 403 — only owner/manager/admin or the branch\'s own branch_operator may issue', async () => {
    const res = await issueQr(dispatcherJwt, SEED.branchId);
    expect(res.status).toBe(403);
  });

  it('9. (CP5) a consultant engaged with the SAME company is rejected with 403', async () => {
    const res = await issueQr(consultantJwt, SEED.branchId);
    expect(res.status).toBe(403);
  });
});
