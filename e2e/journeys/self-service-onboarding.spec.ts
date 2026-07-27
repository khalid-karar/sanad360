import { test, expect } from '@playwright/test';
import { admin } from '../helpers/supabaseAdmin';
import { waitForCapturedEmail, extractVerifyToken } from '../helpers/emailCapture';

/**
 * CP8 Slice F — the first REAL journey built on Slice E's proven pipeline.
 * Drives the entire CP5.5 self-service onboarding flow through a real
 * browser against the production build: /signup -> read the verification
 * token out of the real (captured, never-sent) email -> /verify -> log in
 * as the now-real applicant -> upload the tenant-scoped required documents
 * through real file inputs -> submit_application_for_review (blocked until
 * complete, then succeeds) -> a SEPARATE real reviewer session approves via
 * the real UI -> the applicant sees the real outcome.
 *
 * Where the vitest suite (cp55-self-service-onboarding.test.ts) already
 * proves the RLS/RPC contract at the DB layer, this test proves the same
 * contract is actually WIRED to the UI a real user clicks through — API
 * correctness and UI wiring are different bugs, and only this layer catches
 * the second kind (e.g. a page reading the wrong field name and silently
 * showing nothing, which no unit test touching only the API would catch).
 *
 * Direct DB reads via the service_role client (helpers/supabaseAdmin.ts) are
 * used ONLY to verify outcomes no browser session could see on its own
 * (row ids surviving re-parenting, the audit trail) — every user-facing
 * action goes through the real UI in a real browser.
 */

const RUN = Date.now();
const PASSWORD = 'DevPass1234!';
const APPLICANT_EMAIL = `e2e-onboarding-${RUN}@sanad360.dev`;
const APPLICANT_NAME_AR = `شركة اختبار إي2إي ${RUN}`;
const CR = `${String(RUN).slice(-8)}${Math.floor(Math.random() * 90 + 10)}`; // 10 digits, unique per run

const REVIEWER_EMAIL = 'reviewer@sanad360.dev'; // seeded fixture user (supabase/seed.sql)
const REVIEWER_PASSWORD = 'DevPass1234!';

// Tiny real files through real <input type=file> elements — no client-side
// content validation exists (uploadDocument() only inspects file.name's
// extension and file.type), so minimal valid-shaped bytes are enough.
const PDF_BYTES = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF');

test.setTimeout(90_000);

test('self-service onboarding: signup -> verify -> upload docs -> submit -> reviewer approves', async ({ page, browser }) => {
  let applicationId = '';
  let preApprovalDocIds: string[] = [];

  await test.step('applicant submits /signup as a company applicant', async () => {
    await page.goto('/signup');

    // 'company' is the default-checked radio, but assert it explicitly
    // rather than relying on the default so a future default change fails
    // loud here instead of silently mis-scoping the rest of the journey.
    await expect(page.getByRole('radio', { name: 'منشأة' })).toBeChecked();

    await page.locator('#su-name-ar').fill(APPLICANT_NAME_AR);
    await page.locator('#su-cr').fill(CR);

    // Regression guard (CP8 Slice F finding, migration 043): industries was
    // only granted to `authenticated`, but this dropdown is populated for an
    // ANONYMOUS visitor — the applicant has no session yet at /signup. Before
    // 043 this silently rendered zero real options (SignupPage.tsx's own
    // listIndustries() catch swallows the 42501), permanently blocking every
    // real company applicant. Assert real options exist beyond the
    // placeholder before relying on selectOption() below.
    const industryOptions = page.locator('#su-industry option');
    await expect(industryOptions).not.toHaveCount(1); // more than just the placeholder
    await expect(page.locator('#su-industry option[value="healthcare"]')).toHaveCount(1);

    await page.locator('#su-industry').selectOption('healthcare');
    await page.locator('#su-email').fill(APPLICANT_EMAIL);
    await page.locator('#su-password').fill(PASSWORD);
    await page.getByRole('button', { name: 'تقديم الطلب' }).click();

    // Deliberately ambiguous response (no signup-enumeration oracle) —
    // this confirmation text is shown regardless of what happened server-side.
    await expect(page.getByRole('status')).toContainText('إذا كانت هذه المعلومات جديدة لدينا');
  });

  let verifyToken = '';
  await test.step('read the verification token out of the captured (never-sent) email', async () => {
    const captured = await waitForCapturedEmail(APPLICANT_EMAIL, 'verify');
    expect(captured.locale).toBe('ar'); // signup form defaults to Arabic, unswitched
    verifyToken = extractVerifyToken(captured.vars.link as string);
  });

  await test.step('applicant verifies their email at /verify', async () => {
    await page.goto(`/verify?token=${verifyToken}`);
    await expect(page.getByRole('status')).toContainText('Your email has been verified');
    await page.getByRole('link', { name: 'تسجيل الدخول الآن' }).click();
    await expect(page).toHaveURL(/\/login/);
  });

  await test.step('applicant logs in and lands on /application-status (pending_documents)', async () => {
    await page.locator('#login-identifier').fill(APPLICANT_EMAIL);
    await page.locator('#login-password').fill(PASSWORD);
    await page.getByRole('button', { name: 'تسجيل الدخول' }).click();

    await expect(page).toHaveURL(/\/application-status/);
    await expect(page.getByText('بانتظار رفع المستندات')).toBeVisible();
  });

  await test.step('only company-scoped document requirements are shown, never transport-only ones', async () => {
    await expect(page.getByText('السجل التجاري')).toBeVisible(); // commercial_registration — shared
    await expect(page.getByText('شهادة ضريبة القيمة المضافة')).toBeVisible(); // vat_certificate — company-only
    await expect(page.getByText('ترخيص الهيئة الوطنية لإدارة النفايات')).toHaveCount(0); // ncwm_license — transport-only, must NOT appear
  });

  await test.step('submit-for-review is blocked until every required document is uploaded', async () => {
    await expect(page.getByRole('button', { name: 'إرسال للمراجعة' })).toBeDisabled();
  });

  await test.step('uploads both required documents through real file inputs', async () => {
    await page.getByLabel('السجل التجاري').setInputFiles({
      name: 'commercial-registration.pdf',
      mimeType: 'application/pdf',
      buffer: PDF_BYTES,
    });
    await expect(page.getByText('قيد المراجعة')).toBeVisible({ timeout: 10_000 });

    await page.getByLabel('شهادة ضريبة القيمة المضافة').setInputFiles({
      name: 'vat-certificate.pdf',
      mimeType: 'application/pdf',
      buffer: PDF_BYTES,
    });

    // Both required doc_types now have a non-rejected latest row — completion
    // hits 100% (ApplicationDocumentChecklist's own completeness rule).
    await expect(page.getByText('100%')).toBeVisible();
  });

  await test.step('submit-for-review is now enabled and succeeds', async () => {
    const submitButton = page.getByRole('button', { name: 'إرسال للمراجعة' });
    await expect(submitButton).toBeEnabled();
    await submitButton.click();

    await expect(page.getByText('قيد المراجعة').first()).toBeVisible();
    await expect(page.getByText('طلبك قيد المراجعة')).toBeVisible();
  });

  await test.step('DB check: status is pending_review, and the uploaded document ids are recorded for the re-parenting check below', async () => {
    const { data: app } = await admin
      .from('pending_applications')
      .select('id, status')
      .eq('contact_email', APPLICANT_EMAIL)
      .single<{ id: string; status: string }>();
    expect(app?.status).toBe('pending_review');
    applicationId = app!.id;

    const { data: docs } = await admin
      .from('documents')
      .select('id')
      .eq('owner_type', 'pending_application')
      .eq('owner_id', applicationId);
    expect(docs).toHaveLength(2);
    preApprovalDocIds = (docs ?? []).map((d) => d.id).sort();
  });

  await test.step('a separate reviewer session approves the application via the real UI', async () => {
    const reviewerContext = await browser.newContext();
    const reviewerPage = await reviewerContext.newPage();
    try {
      await reviewerPage.goto('/login');
      await reviewerPage.locator('#login-identifier').fill(REVIEWER_EMAIL);
      await reviewerPage.locator('#login-password').fill(REVIEWER_PASSWORD);
      await reviewerPage.getByRole('button', { name: 'تسجيل الدخول' }).click();
      await expect(reviewerPage).toHaveURL(/\/reviewer/);

      await reviewerPage.goto('/reviewer/applications');
      const row = reviewerPage.getByTestId(`application-review-row-${applicationId}`);
      await expect(row).toBeVisible();
      await expect(row.getByText(CR)).toBeVisible();

      await row.getByRole('button', { name: 'موافقة' }).click();

      // review_pending_application() RPC succeeded (toast) AND the
      // subsequent /admin/notify-application-decision call reported
      // sent:true — asserted via the real "Email sent" UI state, not by
      // trusting real SES delivery (the capture hook diverted it).
      await expect(reviewerPage.getByText('تم إرسال البريد')).toBeVisible({ timeout: 10_000 });
    } finally {
      await reviewerContext.close();
    }
  });

  await test.step('the approval email was captured (never really sent) with the applicant\'s name', async () => {
    const captured = await waitForCapturedEmail(APPLICANT_EMAIL, 'approved');
    expect(captured.text).toContain(APPLICANT_NAME_AR);
  });

  await test.step('applicant reloads and lands directly on their real company dashboard', async () => {
    // A hard reload re-runs App.tsx's mount-time hydrate() BEFORE
    // /application-status's own route guard is evaluated — by then the
    // membership is already promoted 'applicant' -> 'owner' server-side, so
    // the guard (`user?.role === 'applicant'`) no longer matches and
    // redirects to /login, which itself immediately redirects a signed-in
    // user to homeRouteFor(user) = '/company'. The applicant never sees the
    // in-app "approved" card + Continue button on a hard reload — that path
    // exists for staying on the SAME tab without reloading (stale in-memory
    // role, explicit refetch+hydrate via the button) — a full reload always
    // resolves the fresh role first and skips straight to the real
    // dashboard, which is the stronger, more direct proof of the whole
    // pipeline (approval -> membership promotion -> role routing -> a real
    // tenant dashboard) than clicking through an intermediate screen would be.
    await page.reload();
    await expect(page).toHaveURL(/\/company/, { timeout: 10_000 });
  });

  await test.step('DB check: a real tenant + owner membership were created, and documents were re-parented with the SAME ids', async () => {
    const { data: company } = await admin
      .from('companies')
      .select('id')
      .eq('commercial_registration', CR)
      .single<{ id: string }>();
    expect(company?.id).toBeTruthy();
    const companyId = company!.id;

    const { data: membership } = await admin
      .from('memberships')
      .select('role, revoked_at')
      .eq('company_id', companyId)
      .is('revoked_at', null)
      .single<{ role: string; revoked_at: string | null }>();
    expect(membership?.role).toBe('owner');

    const { data: reparentedDocs } = await admin
      .from('documents')
      .select('id')
      .eq('owner_type', 'company')
      .eq('owner_id', companyId);
    expect((reparentedDocs ?? []).map((d) => d.id).sort()).toEqual(preApprovalDocIds);

    const { data: staleDocs } = await admin
      .from('documents')
      .select('id')
      .eq('owner_type', 'pending_application')
      .eq('owner_id', applicationId);
    expect(staleDocs ?? []).toHaveLength(0);
  });
});
