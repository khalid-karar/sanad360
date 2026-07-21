/**
 * Membership soft-revoke (Migration 032, CP5 4g)
 * services/pdf POST /company/revoke-membership
 *
 * Skips automatically if the PDF service isn't reachable (same pattern as
 * phase2-acceptance.test.ts).
 *
 * Assertions:
 *   1. An owner/manager of the SAME company can revoke a manager's own
 *      membership; the row survives (soft-revoke — no DELETE), with
 *      revoked_at/revoked_by/revoke_reason set and an audit_log row written
 *   2. A revoked membership stops being usable at all: fetchMyProfile-shape
 *      query (revoked_at IS NULL filter) returns nothing for that user if it
 *      was their only membership
 *   3. A manager from a DIFFERENT company cannot revoke this membership
 *      (tenant mismatch, 403)
 *   4. Revoking without a reason is rejected (400) — revoke_reason is
 *      mandatory (CHECK constraint)
 *   5. Revoking an already-revoked membership is rejected (409)
 */

import { createClient } from '@supabase/supabase-js';
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

const RUN = Date.now();
const PASSWORD = 'DevPass1234!';

async function isPdfServiceUp(): Promise<boolean> {
  try {
    const res = await fetch(`${PDF_SERVICE_URL}/health`, { signal: AbortSignal.timeout(3_000) });
    return res.ok;
  } catch {
    return false;
  }
}

async function signIn(email: string): Promise<string> {
  const { data, error } = await anon.auth.signInWithPassword({ email, password: PASSWORD });
  if (error || !data.session) throw new Error(`sign-in failed (${email}): ${error?.message}`);
  return data.session.access_token;
}

async function revoke(jwt: string, membershipId: string, reason?: string): Promise<Response> {
  return fetch(`${PDF_SERVICE_URL}/company/revoke-membership`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ membership_id: membershipId, reason }),
  });
}

describe('Membership soft-revoke (Migration 032, services/pdf, CP5 4g)', () => {
  let serviceUp = false;
  let companyId = '';
  let ownerUserId = '';
  let ownerJwt = '';
  let targetUserId = '';
  let targetMembershipId = '';
  let outsiderCompanyId = '';
  let outsiderUserId = '';
  let outsiderJwt = '';

  beforeAll(async () => {
    serviceUp = await isPdfServiceUp();
    if (!serviceUp) return;

    const { data: company } = await admin
      .from('companies')
      .insert({ name_ar: `شركة إلغاء الصلاحية ${RUN}`, commercial_registration: `REVOKE-${RUN}` })
      .select('id').single<{ id: string }>();
    companyId = company!.id;

    const { data: ownerCreated } = await admin.auth.admin.createUser({
      email: `revoke-owner-${RUN}@company.sanad360.dev`, password: PASSWORD, email_confirm: true,
    });
    ownerUserId = ownerCreated.user!.id;
    await admin.from('memberships').insert({ user_id: ownerUserId, role: 'owner', company_id: companyId });
    ownerJwt = await signIn(`revoke-owner-${RUN}@company.sanad360.dev`);

    const { data: targetCreated } = await admin.auth.admin.createUser({
      email: `revoke-target-${RUN}@company.sanad360.dev`, password: PASSWORD, email_confirm: true,
    });
    targetUserId = targetCreated.user!.id;
    const { data: targetMembership } = await admin
      .from('memberships')
      .insert({ user_id: targetUserId, role: 'manager', company_id: companyId })
      .select('id').single<{ id: string }>();
    targetMembershipId = targetMembership!.id;

    const { data: outsiderCompany } = await admin
      .from('companies')
      .insert({ name_ar: `شركة خارجية ${RUN}`, commercial_registration: `REVOKE-OUT-${RUN}` })
      .select('id').single<{ id: string }>();
    outsiderCompanyId = outsiderCompany!.id;

    const { data: outsiderCreated } = await admin.auth.admin.createUser({
      email: `revoke-outsider-${RUN}@company.sanad360.dev`, password: PASSWORD, email_confirm: true,
    });
    outsiderUserId = outsiderCreated.user!.id;
    await admin.from('memberships').insert({ user_id: outsiderUserId, role: 'manager', company_id: outsiderCompanyId });
    outsiderJwt = await signIn(`revoke-outsider-${RUN}@company.sanad360.dev`);
  });

  afterAll(async () => {
    for (const uid of [ownerUserId, targetUserId, outsiderUserId]) {
      if (!uid) continue;
      await admin.from('memberships').delete().eq('user_id', uid);
      await admin.from('profiles').delete().eq('id', uid);
      await admin.auth.admin.deleteUser(uid).catch(() => {});
    }
    if (companyId) await admin.from('companies').delete().eq('id', companyId);
    if (outsiderCompanyId) await admin.from('companies').delete().eq('id', outsiderCompanyId);
  });

  it('3. a manager from a DIFFERENT company cannot revoke this membership', async () => {
    if (!serviceUp) { console.log('SKIP: PDF service not running'); return; }
    const res = await revoke(outsiderJwt, targetMembershipId, 'unrelated attempt');
    expect(res.status).toBe(403);
  });

  it('4. revoking without a reason is rejected (400)', async () => {
    if (!serviceUp) { console.log('SKIP: PDF service not running'); return; }
    const res = await revoke(ownerJwt, targetMembershipId, undefined);
    expect(res.status).toBe(400);
  });

  it('1+2. owner revokes a manager\'s membership — soft (row survives), fields set, audit-logged, and the row stops being usable', async () => {
    if (!serviceUp) { console.log('SKIP: PDF service not running'); return; }
    const res = await revoke(ownerJwt, targetMembershipId, 'مغادرة الشركة');
    expect(res.status).toBe(200);

    const { data: row } = await admin
      .from('memberships')
      .select('id, revoked_at, revoked_by, revoke_reason')
      .eq('id', targetMembershipId)
      .single<{ id: string; revoked_at: string | null; revoked_by: string | null; revoke_reason: string | null }>();
    expect(row).not.toBeNull();
    expect(row!.revoked_at).not.toBeNull();
    expect(row!.revoked_by).toBe(ownerUserId);
    expect(row!.revoke_reason).toBe('مغادرة الشركة');

    const { data: auditRows } = await admin
      .from('audit_log')
      .select('action, entity_id')
      .eq('entity_id', targetMembershipId)
      .eq('action', 'revoke_membership');
    expect((auditRows ?? []).length).toBeGreaterThan(0);

    // Was the target's ONLY membership — a fetchMyProfile-shape query (own
    // row only + revoked_at IS NULL, exactly what auth.ts now applies) finds
    // nothing, mirroring my_membership()'s exclusion at the RLS layer.
    const { data: usable } = await admin
      .from('memberships')
      .select('id')
      .eq('user_id', targetUserId)
      .is('revoked_at', null);
    expect(usable ?? []).toHaveLength(0);
  });

  it('5. revoking an already-revoked membership is rejected (409)', async () => {
    if (!serviceUp) { console.log('SKIP: PDF service not running'); return; }
    const res = await revoke(ownerJwt, targetMembershipId, 'محاولة ثانية');
    expect(res.status).toBe(409);
  });
});
