/**
 * CP5.5 self-service onboarding — RLS + review flow (Migrations 034-041)
 *
 * The signup/verify/notify Express endpoints now exist (services/pdf) and
 * are tested at the HTTP layer over there — this file stays at the DB/RLS/
 * RPC layer, with fixtures built directly via the service-role client
 * mirroring what those endpoints do (createUser -> profiles upsert ->
 * pending_applications insert -> 'applicant' membership insert). Every
 * assertion runs as a REAL signed-in user against RLS / the RPCs, never
 * service_role.
 *
 * State machine as of migration 041: pending_email_verification ->
 * (verify_application_email) -> pending_documents ->
 * (submit_application_for_review) -> pending_review ->
 * (review_pending_application) -> approved | rejected.
 *
 * Assertions:
 *   1. An applicant sees only their OWN pending_applications row — cannot
 *      read another applicant's row (RLS)
 *   2. An applicant calling review_pending_application() is rejected — the
 *      role gate ('applicant' is not document_reviewer/system_admin/admin/
 *      super_admin)
 *   3. approver != applicant: a user who holds BOTH a document_reviewer
 *      membership AND their own applicant membership cannot approve their
 *      own application
 *   4. A real document_reviewer approves -> a real company row is created,
 *      the applicant membership is soft-revoked, a fresh 'owner' membership
 *      is inserted, and a document uploaded under owner_type=
 *      'pending_application' is re-parented onto the new company (same row,
 *      same id, only owner_type/owner_id change)
 *   5. Reject soft-revokes the applicant membership and requires a reason
 *   6. anon cannot call verify_application_email directly (migration 036
 *      revoked anon/authenticated EXECUTE — verification now routes through
 *      the service-role endpoint only); the RPC's own logic still works
 *      correctly when called via service_role: a valid unexpired token
 *      verifies and flips status to pending_documents (migration 041 moved
 *      this target off pending_review), a wrong or expired token does not
 *   7. CR dedupe: a second non-rejected application for the same CR is
 *      blocked by the partial unique index; an application for a CR that's
 *      already a real company is blocked by the BEFORE INSERT trigger
 *   8. (Migration 040) A real document_reviewer running a direct .update()
 *      to re-parent a pending_application-owned document onto an arbitrary
 *      existing company is REJECTED — 038's exception was gated on
 *      can_review_documents() alone (any reviewer session could hit it
 *      directly, bypassing review_pending_application()'s approver!=
 *      applicant check, status requirement, and audit_log write entirely);
 *      040 rebinds it to a transaction-local GUC only
 *      review_pending_application() itself can set
 *   9. Re-parenting inside review_pending_application() only touches THAT
 *      application's own documents — a second, unrelated pending
 *      application's document is untouched by approving a different one
 *   10. (Migration 041) submit_application_for_review()'s completeness gate
 *       is scoped to the application's OWN tenant_type — a company
 *       applicant is blocked while missing vat_certificate but is NEVER
 *       asked for transport_company's ncwm_license, and vice versa; a
 *       rejected upload does not count toward completeness, a re-upload
 *       does; only the owning applicant may call it, and only from
 *       pending_documents
 *   11. The reviewer queue's own status='pending_review' filter excludes a
 *       pending_documents application (RLS grants reviewers visibility into
 *       every status; the queue's OWN query is what scopes it — this proves
 *       that filter actually excludes other statuses rather than silently
 *       returning everything)
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createHash, randomBytes } from 'node:crypto';
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
const PASSWORD = 'DevPass1234!';

async function signIn(email: string): Promise<SupabaseClient> {
  const { data, error } = await anon.auth.signInWithPassword({ email, password: PASSWORD });
  if (error || !data.session) throw new Error(`sign-in failed (${email}): ${error?.message}`);
  return createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${data.session.access_token}` } },
  });
}

function sha256Hex(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

/** Mirrors the future signup endpoint's fixture-creation sequence exactly. */
async function createApplicant(
  emailPrefix: string,
  cr: string,
  tenantType: 'company' | 'transport_company' = 'company'
): Promise<{
  userId: string;
  applicationId: string;
  rawToken: string;
}> {
  const email = `${emailPrefix}-${RUN}@applicant.sanad360.dev`;
  const { data: created, error } = await admin.auth.admin.createUser({
    email, password: PASSWORD, email_confirm: true, // true here only so the test can sign in immediately; the real endpoint starts false and flips it after verify_application_email succeeds
  });
  if (error || !created.user) throw new Error(`createUser failed: ${error?.message}`);
  const userId = created.user.id;

  await admin.from('profiles').upsert({ id: userId, name_ar: `مقدم طلب ${emailPrefix}` }, { onConflict: 'id' });
  await admin.from('memberships').insert({ user_id: userId, role: 'applicant' });

  const rawToken = randomBytes(32).toString('hex');
  const { data: app, error: appErr } = await admin
    .from('pending_applications')
    .insert({
      applicant_user_id: userId,
      tenant_type: tenantType,
      name_ar: `شركة تجريبية ${emailPrefix}`,
      commercial_registration: cr,
      contact_email: email,
      email_verification_token_hash: sha256Hex(rawToken),
      email_verification_expires_at: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
    })
    .select('id')
    .single<{ id: string }>();
  if (appErr || !app) throw new Error(`pending_applications insert failed: ${appErr?.message}`);

  return { userId, applicationId: app.id, rawToken };
}

async function createReviewer(emailPrefix: string): Promise<{ userId: string; client: SupabaseClient }> {
  const email = `${emailPrefix}-${RUN}@maya.sanad360.dev`;
  const { data: created, error } = await admin.auth.admin.createUser({
    email, password: PASSWORD, email_confirm: true,
  });
  if (error || !created.user) throw new Error(`createUser failed: ${error?.message}`);
  const userId = created.user.id;
  await admin.from('profiles').upsert({ id: userId, name_ar: `مراجع ${emailPrefix}` }, { onConflict: 'id' });
  await admin.from('memberships').insert({ user_id: userId, role: 'document_reviewer' });
  const client = await signIn(email);
  return { userId, client };
}

describe('CP5.5 self-service onboarding — RLS + review flow (Migrations 034-041)', () => {
  const cleanupUserIds: string[] = [];
  const cleanupCompanyIds: string[] = [];
  const cleanupApplicationIds: string[] = [];

  let applicantA: { userId: string; applicationId: string; rawToken: string };
  let applicantAClient: SupabaseClient;
  let applicantB: { userId: string; applicationId: string; rawToken: string };
  let reviewerX: { userId: string; client: SupabaseClient };

  // Self-reviewer: holds a document_reviewer membership (created FIRST, so
  // my_membership() — oldest-created-wins when no active-tenant selection
  // exists — resolves to this role, satisfying the role gate) AND their own
  // applicant membership for a SEPARATE application (created second), so
  // the approver != applicant check can be exercised in isolation from the
  // role gate.
  let selfReviewerUserId = '';
  let selfReviewerClient: SupabaseClient;
  let selfApplicationId = '';

  // Dedicated to the CR-dedupe test — never approved/rejected by any other
  // test, so its CR stays in the partial unique index's "active" bucket for
  // the whole run (using applicantA/B's CR after they've been
  // approved/rejected would conflate "pending duplicate" with "already a
  // real company"/"already rejected, resubmission allowed").
  let crDedupeFixture: { userId: string; applicationId: string; rawToken: string };

  beforeAll(async () => {
    applicantA = await createApplicant('applicant-a', `CP55-A-${RUN}`);
    cleanupUserIds.push(applicantA.userId);
    cleanupApplicationIds.push(applicantA.applicationId);
    applicantAClient = await signIn(`applicant-a-${RUN}@applicant.sanad360.dev`);

    applicantB = await createApplicant('applicant-b', `CP55-B-${RUN}`);
    cleanupUserIds.push(applicantB.userId);
    cleanupApplicationIds.push(applicantB.applicationId);

    crDedupeFixture = await createApplicant('cr-dedupe-fixture', `CP55-DEDUPE-${RUN}`);
    cleanupUserIds.push(crDedupeFixture.userId);
    cleanupApplicationIds.push(crDedupeFixture.applicationId);

    reviewerX = await createReviewer('reviewer-x');
    cleanupUserIds.push(reviewerX.userId);

    const selfEmail = `self-reviewer-${RUN}@maya.sanad360.dev`;
    const { data: selfCreated, error: selfErr } = await admin.auth.admin.createUser({
      email: selfEmail, password: PASSWORD, email_confirm: true,
    });
    if (selfErr || !selfCreated.user) throw new Error(`createUser failed: ${selfErr?.message}`);
    selfReviewerUserId = selfCreated.user.id;
    cleanupUserIds.push(selfReviewerUserId);
    await admin.from('profiles').upsert({ id: selfReviewerUserId, name_ar: 'مراجع ذاتي' }, { onConflict: 'id' });
    await admin.from('memberships').insert({ user_id: selfReviewerUserId, role: 'document_reviewer' });
    await admin.from('memberships').insert({ user_id: selfReviewerUserId, role: 'applicant' });
    const { data: selfApp, error: selfAppErr } = await admin
      .from('pending_applications')
      .insert({
        applicant_user_id: selfReviewerUserId,
        tenant_type: 'company',
        name_ar: 'شركة المراجع الذاتي',
        commercial_registration: `CP55-SELF-${RUN}`,
        contact_email: selfEmail,
        status: 'pending_review',
        email_verified_at: new Date().toISOString(),
      })
      .select('id')
      .single<{ id: string }>();
    if (selfAppErr || !selfApp) throw new Error(`self application insert failed: ${selfAppErr?.message}`);
    selfApplicationId = selfApp.id;
    cleanupApplicationIds.push(selfApplicationId);
    selfReviewerClient = await signIn(selfEmail);

    // Move applicantA/applicantB into pending_review (as if email were
    // already verified) so the approve/reject tests below have something
    // reviewable — done directly, not through verify_application_email,
    // since that RPC's own behavior is tested separately in isolation (6).
    await admin.from('pending_applications')
      .update({ status: 'pending_review', email_verified_at: new Date().toISOString() })
      .in('id', [applicantA.applicationId, applicantB.applicationId]);
  });

  afterAll(async () => {
    if (cleanupApplicationIds.length) {
      await admin.from('documents').delete().in('owner_id', cleanupApplicationIds);
      await admin.from('pending_applications').delete().in('id', cleanupApplicationIds);
    }
    if (cleanupCompanyIds.length) await admin.from('companies').delete().in('id', cleanupCompanyIds);
    for (const uid of cleanupUserIds) {
      await admin.from('memberships').delete().eq('user_id', uid);
      await admin.from('profiles').delete().eq('id', uid);
      await admin.auth.admin.deleteUser(uid).catch(() => {});
    }
  });

  it('1. an applicant sees only their OWN application — cannot read another applicant\'s row', async () => {
    const { data: own } = await applicantAClient
      .from('pending_applications')
      .select('id')
      .eq('id', applicantA.applicationId);
    expect(own).toHaveLength(1);

    const { data: other } = await applicantAClient
      .from('pending_applications')
      .select('id')
      .eq('id', applicantB.applicationId);
    expect(other ?? []).toHaveLength(0);
  });

  it('2. an applicant cannot call review_pending_application (role gate)', async () => {
    const { error } = await applicantAClient.rpc('review_pending_application', {
      p_application_id: applicantA.applicationId,
      p_decision: 'approved',
    });
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/FORBIDDEN/i);
  });

  it('3. approver != applicant: a reviewer cannot approve/reject their OWN application', async () => {
    const { error } = await selfReviewerClient.rpc('review_pending_application', {
      p_application_id: selfApplicationId,
      p_decision: 'approved',
    });
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/cannot approve or reject their own application/i);
  });

  it('5. reject requires a reason and soft-revokes the applicant membership', async () => {
    const { error: noReasonErr } = await reviewerX.client.rpc('review_pending_application', {
      p_application_id: applicantB.applicationId,
      p_decision: 'rejected',
    });
    expect(noReasonErr).not.toBeNull();
    expect(noReasonErr!.message).toMatch(/reject_reason is required/i);

    const { data, error } = await reviewerX.client.rpc('review_pending_application', {
      p_application_id: applicantB.applicationId,
      p_decision: 'rejected',
      p_reject_reason: 'Missing municipal license',
    });
    expect(error).toBeNull();
    expect(data?.[0]?.status).toBe('rejected');

    const { data: appRow } = await admin
      .from('pending_applications')
      .select('status, reject_reason, reviewed_by')
      .eq('id', applicantB.applicationId)
      .single<{ status: string; reject_reason: string; reviewed_by: string }>();
    expect(appRow!.status).toBe('rejected');
    expect(appRow!.reject_reason).toBe('Missing municipal license');
    expect(appRow!.reviewed_by).toBe(reviewerX.userId);

    const { data: membership } = await admin
      .from('memberships')
      .select('revoked_at, revoke_reason')
      .eq('user_id', applicantB.userId)
      .eq('role', 'applicant')
      .single<{ revoked_at: string | null; revoke_reason: string | null }>();
    expect(membership!.revoked_at).not.toBeNull();
    expect(membership!.revoke_reason).toMatch(/rejected/i);
  });

  it('4. approval creates a real company, promotes the membership, and re-parents documents', async () => {
    // Upload a document under owner_type='pending_application' as the
    // applicant, BEFORE approval — proves re-parenting preserves the row
    // (same id), not a re-upload.
    const { data: doc, error: docErr } = await applicantAClient
      .from('documents')
      .insert({
        owner_type: 'pending_application',
        owner_id: applicantA.applicationId,
        doc_type: 'commercial_registration',
        file_path: `pending_application/${applicantA.applicationId}/cr.pdf`,
        file_sha256: sha256Hex(`fake-file-contents-${RUN}`),
        uploaded_by: applicantA.userId,
      })
      .select('id')
      .single<{ id: string }>();
    expect(docErr).toBeNull();
    const docId = doc!.id;

    const { data, error } = await reviewerX.client.rpc('review_pending_application', {
      p_application_id: applicantA.applicationId,
      p_decision: 'approved',
    });
    expect(error).toBeNull();
    expect(data?.[0]?.status).toBe('approved');
    const newCompanyId = data?.[0]?.resulting_company_id as string;
    expect(newCompanyId).toBeTruthy();
    cleanupCompanyIds.push(newCompanyId);

    const { data: company } = await admin
      .from('companies')
      .select('id, commercial_registration')
      .eq('id', newCompanyId)
      .single<{ id: string; commercial_registration: string }>();
    expect(company!.commercial_registration).toBe(`CP55-A-${RUN}`);

    const { data: ownerMembership } = await admin
      .from('memberships')
      .select('role, company_id, revoked_at')
      .eq('user_id', applicantA.userId)
      .eq('role', 'owner')
      .single<{ role: string; company_id: string; revoked_at: string | null }>();
    expect(ownerMembership!.company_id).toBe(newCompanyId);
    expect(ownerMembership!.revoked_at).toBeNull();

    const { data: oldApplicantMembership } = await admin
      .from('memberships')
      .select('revoked_at')
      .eq('user_id', applicantA.userId)
      .eq('role', 'applicant')
      .single<{ revoked_at: string | null }>();
    expect(oldApplicantMembership!.revoked_at).not.toBeNull();

    const { data: reparented } = await admin
      .from('documents')
      .select('id, owner_type, owner_id')
      .eq('id', docId)
      .single<{ id: string; owner_type: string; owner_id: string }>();
    expect(reparented!.owner_type).toBe('company');
    expect(reparented!.owner_id).toBe(newCompanyId);

    const { data: auditRows } = await admin
      .from('audit_log')
      .select('action')
      .eq('entity_id', applicantA.applicationId)
      .eq('action', 'approve_pending_application');
    expect((auditRows ?? []).length).toBeGreaterThan(0);
  });

  it('6. anon cannot call verify_application_email directly; the RPC itself works correctly via service_role', async () => {
    const { error: anonErr } = await anon.rpc('verify_application_email', { p_token: applicantA.rawToken });
    expect(anonErr).not.toBeNull();
    expect(anonErr!.code).toBe('42501');

    const wrongToken = randomBytes(32).toString('hex');
    const { data: wrongResult } = await admin.rpc('verify_application_email', { p_token: wrongToken });
    expect(wrongResult?.[0]?.success).toBe(false);

    const { data: staleResult, error: staleErr } = await admin.rpc('verify_application_email', {
      p_token: applicantB.rawToken,
    });
    expect(staleErr).toBeNull();
    // applicantB's application was already moved to 'pending_review' (then
    // 'rejected') directly in beforeAll/test 5 — its ORIGINAL token is
    // therefore stale (status no longer 'pending_email_verification'), so
    // this correctly reports failure too. Confirms the RPC checks status,
    // not just the hash match.
    expect(staleResult?.[0]?.success).toBe(false);

    // Happy path: crDedupeFixture was never touched by any review action —
    // still genuinely 'pending_email_verification' — so its real token
    // should verify successfully and flip status to 'pending_documents'
    // (migration 041 moved this target off 'pending_review' — documents are
    // now collected AFTER verification, not at signup time).
    const { data: happyResult, error: happyErr } = await admin.rpc('verify_application_email', {
      p_token: crDedupeFixture.rawToken,
    });
    expect(happyErr).toBeNull();
    expect(happyResult?.[0]?.success).toBe(true);
    expect(happyResult?.[0]?.application_id).toBe(crDedupeFixture.applicationId);

    const { data: appRow } = await admin
      .from('pending_applications')
      .select('status, email_verified_at, email_verification_token_hash')
      .eq('id', crDedupeFixture.applicationId)
      .single<{ status: string; email_verified_at: string | null; email_verification_token_hash: string | null }>();
    expect(appRow!.status).toBe('pending_documents');
    expect(appRow!.email_verified_at).not.toBeNull();
    expect(appRow!.email_verification_token_hash).toBeNull();
  });

  it('7. CR dedupe: a second non-rejected application for the same CR is blocked, and so is a CR that\'s already a real company', async () => {
    const { error: dupeErr } = await admin.from('pending_applications').insert({
      applicant_user_id: applicantB.userId,
      tenant_type: 'company',
      name_ar: 'محاولة تسجيل مكررة',
      commercial_registration: `CP55-DEDUPE-${RUN}`, // same CR as crDedupeFixture, which stays untouched (never approved/rejected) for the whole run
      contact_email: `dupe-${RUN}@applicant.sanad360.dev`,
    });
    expect(dupeErr).not.toBeNull();
    expect(dupeErr!.code).toBe('23505');

    const { data: realCompany } = await admin
      .from('companies')
      .select('commercial_registration')
      .limit(1)
      .single<{ commercial_registration: string }>();
    const { error: registeredErr } = await admin.from('pending_applications').insert({
      applicant_user_id: applicantB.userId,
      tenant_type: 'company',
      name_ar: 'محاولة تسجيل لشركة موجودة',
      commercial_registration: realCompany!.commercial_registration,
      contact_email: `dupe2-${RUN}@applicant.sanad360.dev`,
    });
    expect(registeredErr).not.toBeNull();
    expect(registeredErr!.code).toBe('23505');
  });

  it('8. a document_reviewer cannot bypass review_pending_application by re-parenting a document directly', async () => {
    // Dedicated application + document, untouched by any other test in this
    // file — isolates this from the approve/reject state churn above.
    const bypassApplicant = await createApplicant('bypass-target', `CP55-BYPASS-${RUN}`);
    cleanupUserIds.push(bypassApplicant.userId);
    cleanupApplicationIds.push(bypassApplicant.applicationId);
    const bypassApplicantClient = await signIn(`bypass-target-${RUN}@applicant.sanad360.dev`);

    const { data: doc, error: docErr } = await bypassApplicantClient
      .from('documents')
      .insert({
        owner_type: 'pending_application',
        owner_id: bypassApplicant.applicationId,
        doc_type: 'commercial_registration',
        file_path: `pending_application/${bypassApplicant.applicationId}/cr.pdf`,
        file_sha256: sha256Hex(`bypass-fixture-${RUN}`),
        uploaded_by: bypassApplicant.userId,
      })
      .select('id')
      .single<{ id: string }>();
    expect(docErr).toBeNull();

    // An arbitrary EXISTING real company — a dedicated one, not shared seed
    // data, per this suite's own convention.
    const { data: targetCompany } = await admin
      .from('companies')
      .insert({ name_ar: `شركة هدف التحايل ${RUN}`, commercial_registration: `CP55-BYPASS-TARGET-${RUN}` })
      .select('id')
      .single<{ id: string }>();
    cleanupCompanyIds.push(targetCompany!.id);

    // reviewerX is a REAL document_reviewer — RLS's documents_update policy
    // (can_review_documents()) lets this UPDATE reach the trigger. Before
    // migration 040 this succeeded outright (038's exception only checked
    // can_review_documents(), same as this call satisfies) — the whole
    // point of 040 is that it no longer does.
    const { error: bypassErr } = await reviewerX.client
      .from('documents')
      .update({ owner_type: 'company', owner_id: targetCompany!.id })
      .eq('id', doc!.id);
    expect(bypassErr).not.toBeNull();
    expect(bypassErr!.message).toMatch(/review_pending_application/i);

    const { data: stillPending } = await admin
      .from('documents')
      .select('owner_type, owner_id')
      .eq('id', doc!.id)
      .single<{ owner_type: string; owner_id: string }>();
    expect(stillPending!.owner_type).toBe('pending_application');
    expect(stillPending!.owner_id).toBe(bypassApplicant.applicationId);
  });

  it('9. re-parenting only touches the approved application\'s own documents, not another pending application\'s', async () => {
    const toApprove = await createApplicant('isolation-approve', `CP55-ISOA-${RUN}`);
    cleanupUserIds.push(toApprove.userId);
    cleanupApplicationIds.push(toApprove.applicationId);
    await admin.from('pending_applications')
      .update({ status: 'pending_review', email_verified_at: new Date().toISOString() })
      .eq('id', toApprove.applicationId);
    const toApproveClient = await signIn(`isolation-approve-${RUN}@applicant.sanad360.dev`);

    const bystander = await createApplicant('isolation-bystander', `CP55-ISOB-${RUN}`);
    cleanupUserIds.push(bystander.userId);
    cleanupApplicationIds.push(bystander.applicationId);
    const bystanderClient = await signIn(`isolation-bystander-${RUN}@applicant.sanad360.dev`);

    const { data: docToApprove } = await toApproveClient
      .from('documents')
      .insert({
        owner_type: 'pending_application',
        owner_id: toApprove.applicationId,
        doc_type: 'commercial_registration',
        file_path: `pending_application/${toApprove.applicationId}/cr.pdf`,
        file_sha256: sha256Hex(`isolation-approve-${RUN}`),
        uploaded_by: toApprove.userId,
      })
      .select('id')
      .single<{ id: string }>();

    const { data: docBystander } = await bystanderClient
      .from('documents')
      .insert({
        owner_type: 'pending_application',
        owner_id: bystander.applicationId,
        doc_type: 'commercial_registration',
        file_path: `pending_application/${bystander.applicationId}/cr.pdf`,
        file_sha256: sha256Hex(`isolation-bystander-${RUN}`),
        uploaded_by: bystander.userId,
      })
      .select('id')
      .single<{ id: string }>();

    const { data, error } = await reviewerX.client.rpc('review_pending_application', {
      p_application_id: toApprove.applicationId,
      p_decision: 'approved',
    });
    expect(error).toBeNull();
    const newCompanyId = data?.[0]?.resulting_company_id as string;
    cleanupCompanyIds.push(newCompanyId);

    const { data: approvedDoc } = await admin
      .from('documents')
      .select('owner_type, owner_id')
      .eq('id', docToApprove!.id)
      .single<{ owner_type: string; owner_id: string }>();
    expect(approvedDoc!.owner_type).toBe('company');
    expect(approvedDoc!.owner_id).toBe(newCompanyId);

    const { data: bystanderDoc } = await admin
      .from('documents')
      .select('owner_type, owner_id')
      .eq('id', docBystander!.id)
      .single<{ owner_type: string; owner_id: string }>();
    expect(bystanderDoc!.owner_type).toBe('pending_application');
    expect(bystanderDoc!.owner_id).toBe(bystander.applicationId);
  });

  it('10. submit_application_for_review: tenant-scoped completeness gate, auth gate, status gate', async () => {
    // ── Company applicant: required = {commercial_registration, vat_certificate} ──
    const companyApp = await createApplicant('submit-company', `CP55-SUBMITCO-${RUN}`, 'company');
    cleanupUserIds.push(companyApp.userId);
    cleanupApplicationIds.push(companyApp.applicationId);
    await admin.from('pending_applications')
      .update({ status: 'pending_documents', email_verified_at: new Date().toISOString() })
      .eq('id', companyApp.applicationId);
    const companyClient = await signIn(`submit-company-${RUN}@applicant.sanad360.dev`);

    // Auth gate: another applicant cannot submit THIS application.
    const { error: wrongOwnerErr } = await applicantAClient.rpc('submit_application_for_review', {
      p_application_id: companyApp.applicationId,
    });
    expect(wrongOwnerErr).not.toBeNull();
    expect(wrongOwnerErr!.message).toMatch(/FORBIDDEN/i);

    // Status gate: a genuinely-owned application that's already past
    // pending_documents must reject submit, even for its rightful owner.
    const wrongStageApp = await createApplicant('submit-wrongstage', `CP55-WRONGSTAGE-${RUN}`, 'company');
    cleanupUserIds.push(wrongStageApp.userId);
    cleanupApplicationIds.push(wrongStageApp.applicationId);
    await admin.from('pending_applications')
      .update({ status: 'pending_review', email_verified_at: new Date().toISOString() })
      .eq('id', wrongStageApp.applicationId);
    const wrongStageClient = await signIn(`submit-wrongstage-${RUN}@applicant.sanad360.dev`);
    const { error: wrongStatusErr } = await wrongStageClient.rpc('submit_application_for_review', {
      p_application_id: wrongStageApp.applicationId,
    });
    expect(wrongStatusErr).not.toBeNull();
    expect(wrongStatusErr!.message).toMatch(/not awaiting document submission/i);

    // Missing vat_certificate -> INCOMPLETE_DOCUMENTS, naming the missing type.
    await companyClient.from('documents').insert({
      owner_type: 'pending_application',
      owner_id: companyApp.applicationId,
      doc_type: 'commercial_registration',
      file_path: `pending_application/${companyApp.applicationId}/cr.pdf`,
      file_sha256: sha256Hex(`submit-company-cr-${RUN}`),
      uploaded_by: companyApp.userId,
    });
    const { error: incompleteErr } = await companyClient.rpc('submit_application_for_review', {
      p_application_id: companyApp.applicationId,
    });
    expect(incompleteErr).not.toBeNull();
    expect(incompleteErr!.message).toMatch(/INCOMPLETE_DOCUMENTS/);
    expect(incompleteErr!.message).toMatch(/vat_certificate/);
    // Tenant-scoping proof: the gate must NEVER ask a company applicant for
    // transport_company's ncwm_license — it isn't in company's own required
    // list, unlike the 'pending_application' union (037) which would wrongly
    // include it.
    expect(incompleteErr!.message).not.toMatch(/ncwm_license/);

    let { data: stillDocuments } = await admin
      .from('pending_applications').select('status').eq('id', companyApp.applicationId).single<{ status: string }>();
    expect(stillDocuments!.status).toBe('pending_documents');

    // Upload vat_certificate too -> now complete -> submit succeeds.
    await companyClient.from('documents').insert({
      owner_type: 'pending_application',
      owner_id: companyApp.applicationId,
      doc_type: 'vat_certificate',
      file_path: `pending_application/${companyApp.applicationId}/vat.pdf`,
      file_sha256: sha256Hex(`submit-company-vat-${RUN}`),
      uploaded_by: companyApp.userId,
    });
    const { data: submitOk, error: submitErr } = await companyClient.rpc('submit_application_for_review', {
      p_application_id: companyApp.applicationId,
    });
    expect(submitErr).toBeNull();
    expect(submitOk?.[0]?.status).toBe('pending_review');

    const { data: afterSubmit } = await admin
      .from('pending_applications').select('status').eq('id', companyApp.applicationId).single<{ status: string }>();
    expect(afterSubmit!.status).toBe('pending_review');

    // ── Transport applicant: required = {commercial_registration, ncwm_license} ──
    // never vat_certificate, which is company-only — proves the same gate
    // correctly scopes to whichever tenant_type this application actually is.
    const transportApp = await createApplicant('submit-transport', `CP55-SUBMITTR-${RUN}`, 'transport_company');
    cleanupUserIds.push(transportApp.userId);
    cleanupApplicationIds.push(transportApp.applicationId);
    await admin.from('pending_applications')
      .update({ status: 'pending_documents', email_verified_at: new Date().toISOString() })
      .eq('id', transportApp.applicationId);
    const transportClient = await signIn(`submit-transport-${RUN}@applicant.sanad360.dev`);

    await transportClient.from('documents').insert({
      owner_type: 'pending_application',
      owner_id: transportApp.applicationId,
      doc_type: 'commercial_registration',
      file_path: `pending_application/${transportApp.applicationId}/cr.pdf`,
      file_sha256: sha256Hex(`submit-transport-cr-${RUN}`),
      uploaded_by: transportApp.userId,
    });
    await transportClient.from('documents').insert({
      owner_type: 'pending_application',
      owner_id: transportApp.applicationId,
      doc_type: 'ncwm_license',
      file_path: `pending_application/${transportApp.applicationId}/ncwm.pdf`,
      file_sha256: sha256Hex(`submit-transport-ncwm-${RUN}`),
      uploaded_by: transportApp.userId,
    });
    const { data: transportSubmitOk, error: transportSubmitErr } = await transportClient.rpc('submit_application_for_review', {
      p_application_id: transportApp.applicationId,
    });
    expect(transportSubmitErr).toBeNull();
    expect(transportSubmitOk?.[0]?.status).toBe('pending_review');
  });

  it('11. a rejected upload does not satisfy completeness; re-upload does', async () => {
    const app = await createApplicant('submit-reupload', `CP55-REUP-${RUN}`, 'company');
    cleanupUserIds.push(app.userId);
    cleanupApplicationIds.push(app.applicationId);
    await admin.from('pending_applications')
      .update({ status: 'pending_documents', email_verified_at: new Date().toISOString() })
      .eq('id', app.applicationId);
    const client = await signIn(`submit-reupload-${RUN}@applicant.sanad360.dev`);

    await client.from('documents').insert({
      owner_type: 'pending_application', owner_id: app.applicationId, doc_type: 'vat_certificate',
      file_path: `pending_application/${app.applicationId}/vat.pdf`, file_sha256: sha256Hex(`reup-vat-${RUN}`), uploaded_by: app.userId,
    });
    const { data: crDoc } = await client.from('documents').insert({
      owner_type: 'pending_application', owner_id: app.applicationId, doc_type: 'commercial_registration',
      file_path: `pending_application/${app.applicationId}/cr-v1.pdf`, file_sha256: sha256Hex(`reup-cr-v1-${RUN}`), uploaded_by: app.userId,
    }).select('id').single<{ id: string }>();

    // Reviewer rejects the CR upload.
    await reviewerX.client.from('documents')
      .update({ status: 'rejected', reject_reason: 'Illegible scan' })
      .eq('id', crDoc!.id);

    const { error: stillIncompleteErr } = await client.rpc('submit_application_for_review', {
      p_application_id: app.applicationId,
    });
    expect(stillIncompleteErr).not.toBeNull();
    expect(stillIncompleteErr!.message).toMatch(/INCOMPLETE_DOCUMENTS/);
    expect(stillIncompleteErr!.message).toMatch(/commercial_registration/);

    // Re-upload (newer row, same doc_type) -> latest is 'pending' again -> complete.
    await client.from('documents').insert({
      owner_type: 'pending_application', owner_id: app.applicationId, doc_type: 'commercial_registration',
      file_path: `pending_application/${app.applicationId}/cr-v2.pdf`, file_sha256: sha256Hex(`reup-cr-v2-${RUN}`), uploaded_by: app.userId,
    });
    const { data: ok, error: okErr } = await client.rpc('submit_application_for_review', {
      p_application_id: app.applicationId,
    });
    expect(okErr).toBeNull();
    expect(ok?.[0]?.status).toBe('pending_review');
  });

  it('12. the reviewer queue\'s status=pending_review filter excludes a pending_documents application', async () => {
    const stillPendingDocs = await createApplicant('queue-filter', `CP55-QFILTER-${RUN}`, 'company');
    cleanupUserIds.push(stillPendingDocs.userId);
    cleanupApplicationIds.push(stillPendingDocs.applicationId);
    await admin.from('pending_applications')
      .update({ status: 'pending_documents', email_verified_at: new Date().toISOString() })
      .eq('id', stillPendingDocs.applicationId);

    // Same query shape as listApplicationsPendingReview() (src/lib/api/applications.ts).
    const { data: queue } = await reviewerX.client
      .from('pending_applications')
      .select('id')
      .eq('status', 'pending_review');
    const queueIds = (queue ?? []).map((r: { id: string }) => r.id);
    expect(queueIds).not.toContain(stillPendingDocs.applicationId);
    // selfApplicationId was seeded straight into 'pending_review' in beforeAll
    // and never decided by any test — sanity check the filter isn't just
    // returning an empty set for the wrong reason.
    expect(queueIds).toContain(selfApplicationId);
  });
});
