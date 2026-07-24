import { test, expect } from '@playwright/test';
import { createHash } from 'node:crypto';
import { admin } from '../helpers/supabaseAdmin';
import { createCompanyTenant, createTransportTenant, adminAuthHeader } from '../helpers/fixtures';
import { extractPdfText } from '../helpers/pdf';

/**
 * CP8 Slice G — the full operating chain, real browser, real production
 * build. Starts from a pre-approved company + transport company (CP8 Slice F
 * already proved the self-service onboarding UI that gets a tenant to this
 * point — grandfathered via service_role fixtures here, see
 * e2e/helpers/fixtures.ts, so this test spends its time on NEW ground):
 * branch onboarding -> driver/vehicle onboarding with real document upload
 * -> a reviewer verifying them via the real UI -> transporter linking ->
 * pickup scheduling -> a driver executing a real pickup (real dynamic branch
 * QR via manual entry, real geofence via Playwright's geolocation mock, real
 * evidence files) -> a trip to a facility -> a scale operator confirming the
 * weighbridge weight -> weight reconciliation -> downloading and verifying
 * the inspection PDF and the All-Branches pack.
 *
 * Facility creation/linking has NO browser UI anywhere in this app (grep
 * confirms /admin/facilities and /admin/invite-recycler are services/pdf
 * HTTP endpoints only) — that stage authenticates as the seeded admin
 * account and calls those endpoints directly (a real server-side action,
 * not a UI bypass; there is no UI to bypass).
 *
 * Every OTHER stage drives the real UI in a real browser. Where a UI has a
 * known hardcoded-mock widget (TransportKPIs/AdminKPIs/ComplianceMap/
 * CompaniesTable — KNOWN_LIMITATIONS.md's CP7 section), this test navigates
 * directly to the specific page it needs rather than landing on that
 * dashboard, so those widgets are never rendered and never asserted on.
 */

const RUN = Date.now();
const PASSWORD = 'DevPass1234!';
const PDF_SERVICE_URL = process.env.VITE_PDF_SERVICE_URL ?? 'http://127.0.0.1:3001';

// A fixed, known point (central Riyadh) used as the branch's geofence
// center AND the driver's mocked device location — distance 0, so the
// geofence check passes regardless of radius.
const BRANCH_LAT = 24.7136;
const BRANCH_LNG = 46.6753;

const BRANCH_NAME = `فرع السلسلة ${RUN}`;
const COMPANY_CR = `E2EG${RUN}`; // matches createCompanyTenant()'s commercial_registration exactly
const FACILITY_NAME = `منشأة إعادة تدوير السلسلة ${RUN}`;
const DRIVER_NAME = `سائق السلسلة ${RUN}`;
const VEHICLE_PLATE = `E2EG${RUN.toString().slice(-6)}`;
const PICKUP_WEIGHT_KG = '500';
const WASTE_STREAM = 'plastic'; // 2.5% reconciliation tolerance (migration 018)

const TINY_PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF');
const TINY_JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0xff, 0xd9]);

test.setTimeout(180_000);

test('full operating chain: branch -> transporter -> facility -> trip -> weighbridge -> reconciliation -> PDF', async ({ browser }) => {
  // ── Fixtures: pre-approved tenants (Slice F already proved this UI) ──────
  const company = await createCompanyTenant(RUN);
  const transport = await createTransportTenant(RUN);

  let facilityId = '';
  let scaleOperatorEmail = '';
  await test.step('admin creates a facility and its first scale_operator (no browser UI exists for this — real server action)', async () => {
    const headers = await adminAuthHeader();
    const facRes = await fetch(`${PDF_SERVICE_URL}/admin/facilities`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name_ar: FACILITY_NAME }),
    });
    const facBody = await facRes.text();
    expect(facRes.ok, facBody).toBe(true);
    const facJson = JSON.parse(facBody) as { facility_id: string };
    facilityId = facJson.facility_id;

    scaleOperatorEmail = `e2e-g-scale-${RUN}@sanad360.dev`;
    const inviteRes = await fetch(`${PDF_SERVICE_URL}/admin/invite-recycler`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        facility_id: facilityId, role: 'scale_operator', email: scaleOperatorEmail,
        temp_password: PASSWORD, name_ar: 'مشغل الميزان',
      }),
    });
    const inviteBody = await inviteRes.text();
    expect(inviteRes.ok, inviteBody).toBe(true);

    // facility_transporters has no browser UI either (confirmed via grep) —
    // the same real-server-action posture as facility creation itself.
    const { error } = await admin.from('facility_transporters').insert({
      transport_company_id: transport.transportCompanyId, facility_id: facilityId, status: 'active',
    });
    expect(error).toBeNull();
  });

  const companyCtx = await browser.newContext();
  const companyPage = await companyCtx.newPage();
  let branchId = '';

  await test.step('company owner creates a branch with a real geofence and uploads its required document', async () => {
    await companyPage.goto('/login');
    await companyPage.locator('#login-identifier').fill(company.ownerEmail);
    await companyPage.locator('#login-password').fill(company.password);
    await companyPage.getByRole('button', { name: 'تسجيل الدخول' }).click();
    await expect(companyPage).toHaveURL(/\/company/);

    await companyPage.goto('/company/branches');
    // Two matches on a fresh (empty) branch list: the header button and the
    // EmptyState's own action button — both open the same form; use the header one.
    await companyPage.getByRole('button', { name: 'إضافة فرع' }).first().click();
    // Neither BranchesPage's own fields nor GeofenceMapPicker's manual
    // lat/lng fallback inputs associate their <Label>/<label> with the
    // input (no htmlFor/id, no wrapping) — a real, minor a11y gap, same
    // class as CP8 Slice E's CardTitle finding. getByLabel() can't bind;
    // target via the adjacent-sibling DOM relationship instead.
    await companyPage.locator('label:text-is("الاسم (عربي)") + input').fill(BRANCH_NAME);
    await companyPage.locator('label:text-is("خط العرض") + input').fill(String(BRANCH_LAT));
    await companyPage.locator('label:text-is("خط الطول") + input').fill(String(BRANCH_LNG));

    await companyPage.getByRole('button', { name: 'حفظ' }).click();
    await expect(companyPage.getByText(BRANCH_NAME)).toBeVisible();

    const { data: branch } = await admin
      .from('branches').select('id').eq('company_id', company.companyId).single<{ id: string }>();
    branchId = branch!.id;

    await companyPage.getByRole('button', { name: 'مستندات الفرع' }).click();
    await companyPage.getByLabel('الرخصة البلدية').setInputFiles({
      name: 'municipal-license.pdf', mimeType: 'application/pdf', buffer: TINY_PDF,
    });
    await expect(companyPage.getByText('قيد المراجعة')).toBeVisible({ timeout: 10_000 });
    await companyPage.getByText('إغلاق', { exact: true }).click(); // the visible-text Close button, not the Modal's icon-only "X"
  });

  const transportCtx = await browser.newContext();
  const transportPage = await transportCtx.newPage();
  let driverId = '';
  let vehicleId = '';
  let driverLoginEmail = '';

  await test.step('transport owner adds a driver and a vehicle, uploads their required documents', async () => {
    await transportPage.goto('/login');
    await transportPage.locator('#login-identifier').fill(transport.ownerEmail);
    await transportPage.locator('#login-password').fill(transport.password);
    await transportPage.getByRole('button', { name: 'تسجيل الدخول' }).click();
    await expect(transportPage).toHaveURL(/\/transport/);

    // Navigate directly to sub-pages rather than the /transport dashboard —
    // TransportKPIs there renders hardcoded mock numbers (KNOWN_LIMITATIONS.md,
    // CP7 section); this journey never needs that page, so it's never rendered.
    await transportPage.goto('/transport/drivers');
    await transportPage.getByRole('button', { name: 'إضافة سائق' }).click();
    await transportPage.locator('#driver-name').fill(DRIVER_NAME);
    await transportPage.locator('#driver-license-number').fill(`DL-${RUN}`);
    await transportPage.locator('#driver-license-expiry').fill('2030-01-01');
    await transportPage.getByRole('button', { name: 'إضافة السائق', exact: true }).click();
    await expect(transportPage.getByText(DRIVER_NAME)).toBeVisible();

    const { data: driver } = await admin
      .from('drivers').select('id').eq('transport_company_id', transport.transportCompanyId)
      .eq('name_ar', DRIVER_NAME).single<{ id: string }>();
    driverId = driver!.id;

    const driverRow = transportPage.locator('.border-2').filter({ hasText: DRIVER_NAME });
    await driverRow.getByRole('button', { name: 'المستندات' }).click();
    await transportPage.getByLabel('الإقامة').setInputFiles({ name: 'iqama.pdf', mimeType: 'application/pdf', buffer: TINY_PDF });
    await expect(transportPage.getByText('قيد المراجعة').first()).toBeVisible({ timeout: 10_000 });
    await transportPage.getByLabel('رخصة القيادة').setInputFiles({ name: 'driving-license.pdf', mimeType: 'application/pdf', buffer: TINY_PDF });
    // owner_document_status() (migration 021) only counts VERIFIED docs
    // toward completion_pct, not merely-uploaded/pending ones — 100% only
    // shows up after the reviewer step below, unlike the CP5.5 application
    // checklist's own (looser) "not rejected" completeness rule.
    await expect(transportPage.getByText('قيد المراجعة').nth(1)).toBeVisible({ timeout: 10_000 });
    await transportPage.getByText('إغلاق', { exact: true }).click(); // the visible-text Close button, not the Modal's icon-only "X"

    // Invite: turns the fleet record into a real sign-in-able account.
    const inviteRow = transportPage.locator('.border-2').filter({ hasText: DRIVER_NAME });
    await inviteRow.getByRole('button', { name: 'دعوة' }).click();
    const driverPhone = `05${RUN.toString().slice(-8)}`;
    await transportPage.locator('#invite-phone').fill(driverPhone);
    await transportPage.locator('#invite-password').fill('DriverTemp1234!');
    await transportPage.getByRole('button', { name: 'إنشاء الحساب' }).click();
    await expect(transportPage.getByText('تم إنشاء الحساب')).toBeVisible({ timeout: 10_000 });
    driverLoginEmail = `${driverPhone.replace(/\D/g, '')}@driver.sanad360.com`;
    await transportPage.getByText('إغلاق', { exact: true }).click(); // the visible-text Close button, not the Modal's icon-only "X"

    // Vehicle
    await transportPage.goto('/transport/vehicles');
    await transportPage.getByRole('button', { name: 'إضافة مركبة' }).click();
    await transportPage.locator('#vehicle-plate').fill(VEHICLE_PLATE);
    await transportPage.locator('#vehicle-type').click();
    await transportPage.getByRole('option', { name: 'شاحنة صغيرة' }).click();
    await transportPage.locator('#vehicle-waste-license').click();
    await transportPage.getByRole('option', { name: 'نفايات عامة' }).click();
    await transportPage.locator('#vehicle-ncwm-expiry').fill('2030-01-01');
    await transportPage.getByRole('button', { name: 'إضافة المركبة' }).click();
    await expect(transportPage.getByText(VEHICLE_PLATE)).toBeVisible();

    const { data: vehicle } = await admin
      .from('vehicles').select('id').eq('transport_company_id', transport.transportCompanyId)
      .eq('plate_number', VEHICLE_PLATE).single<{ id: string }>();
    vehicleId = vehicle!.id;

    const vehicleRow = transportPage.locator('.border-2').filter({ hasText: VEHICLE_PLATE });
    await vehicleRow.getByRole('button', { name: 'المستندات' }).click();
    await transportPage.getByLabel('استمارة تسجيل المركبة').setInputFiles({ name: 'vehicle-reg.pdf', mimeType: 'application/pdf', buffer: TINY_PDF });
    await expect(transportPage.getByText('قيد المراجعة').first()).toBeVisible({ timeout: 10_000 });
    await transportPage.getByLabel('ترخيص NCWM للمركبة').setInputFiles({ name: 'vehicle-ncwm.pdf', mimeType: 'application/pdf', buffer: TINY_PDF });
    await expect(transportPage.getByText('قيد المراجعة').nth(1)).toBeVisible({ timeout: 10_000 });
    await transportPage.getByText('إغلاق', { exact: true }).click(); // the visible-text Close button, not the Modal's icon-only "X"
  });

  await test.step('a reviewer verifies all 5 pending documents (branch, driver x2, vehicle x2) via the real UI', async () => {
    const { data: pendingDocs } = await admin
      .from('documents').select('id')
      .in('owner_id', [branchId, driverId, vehicleId])
      .eq('status', 'pending');
    expect(pendingDocs).toHaveLength(5);

    const reviewerCtx = await browser.newContext();
    const reviewerPage = await reviewerCtx.newPage();
    try {
      await reviewerPage.goto('/login');
      await reviewerPage.locator('#login-identifier').fill('reviewer@sanad360.dev');
      await reviewerPage.locator('#login-password').fill(PASSWORD);
      await reviewerPage.getByRole('button', { name: 'تسجيل الدخول' }).click();
      await expect(reviewerPage).toHaveURL(/\/reviewer/);

      await reviewerPage.goto('/admin/document-review');
      for (const doc of pendingDocs!) {
        const row = reviewerPage.getByTestId(`document-review-row-${doc.id}`);
        await expect(row).toBeVisible({ timeout: 10_000 });
        await row.getByRole('button', { name: 'توثيق' }).click();
        await expect(row).toHaveCount(0, { timeout: 10_000 });
      }
    } finally {
      await reviewerCtx.close();
    }
  });

  await test.step('DB check: driver, vehicle, company, and transport_company are all operationally unblocked', async () => {
    const { data: docs } = await admin
      .from('documents').select('status')
      .in('owner_id', [driverId, vehicleId])
      .eq('status', 'verified');
    expect((docs ?? []).length).toBe(4);
  });

  await test.step('company owner links the transport company as an approved transporter', async () => {
    await companyPage.goto('/company/transporters');
    await companyPage.getByRole('button', { name: 'إضافة ناقل' }).first().click();
    await companyPage.locator('#tc-select').selectOption(transport.transportCompanyId);
    await companyPage.getByRole('button', { name: 'ربط' }).click();
    await expect(companyPage.getByText('نشط').first()).toBeVisible();
  });

  let assignmentId = '';
  await test.step('company owner schedules a pickup for the new branch/driver/vehicle', async () => {
    await companyPage.goto('/company/schedule');
    // The sidebar nav item for this very page is ALSO labeled "طلب التقاط"
    // (the page name and its own primary action happen to share the exact
    // same Arabic string) — scope to <main> for the real action button.
    await companyPage.locator('main').getByRole('button', { name: 'طلب التقاط' }).click();
    await companyPage.locator('#schedule-branch').selectOption(branchId);
    await companyPage.locator('#schedule-driver').selectOption(driverId);
    await companyPage.locator('#schedule-vehicle').selectOption(vehicleId);

    // DateTimePicker (src/components/ui/date-picker.tsx) is a fully
    // controlled component: each segment's onChange computes its `next`
    // value from a `parts` snapshot derived from the CURRENT `value` prop,
    // then round-trips through the parent's setState before the next
    // render reflects it. Firing all 5 .fill() calls back-to-back races
    // ahead of that round-trip — each one silently computes from a stale
    // (pre-previous-fill) snapshot, clobbering earlier segments. A real
    // user's keystrokes are slow enough never to hit this; Playwright's
    // aren't. Wait for each segment's own value to settle before the next.
    const inOneHour = new Date(Date.now() + 60 * 60 * 1000);
    const day = String(inOneHour.getDate()).padStart(2, '0');
    const month = String(inOneHour.getMonth() + 1).padStart(2, '0');
    const year = String(inOneHour.getFullYear());
    const hour = String(inOneHour.getHours()).padStart(2, '0');
    const minute = String(inOneHour.getMinutes()).padStart(2, '0');

    await companyPage.getByLabel('اليوم').fill(day);
    await expect(companyPage.getByLabel('اليوم')).toHaveValue(day);
    await companyPage.getByLabel('الشهر').fill(month);
    await expect(companyPage.getByLabel('الشهر')).toHaveValue(month);
    await companyPage.getByLabel('السنة').fill(year);
    await expect(companyPage.getByLabel('السنة')).toHaveValue(year);
    await companyPage.getByLabel('الساعة').fill(hour);
    await expect(companyPage.getByLabel('الساعة')).toHaveValue(hour);
    await companyPage.getByLabel('الدقيقة').fill(minute);
    await expect(companyPage.getByLabel('الدقيقة')).toHaveValue(minute);

    await companyPage.getByRole('button', { name: 'حفظ' }).click();

    await expect(async () => {
      const { data: assignment } = await admin
        .from('pickup_assignments').select('id').eq('company_id', company.companyId)
        .order('created_at', { ascending: false }).limit(1).maybeSingle<{ id: string }>();
      expect(assignment).toBeTruthy();
      assignmentId = assignment!.id;
    }).toPass({ timeout: 10_000 });
  });

  let tripId = '';
  await test.step('transport owner creates a trip to the linked facility and groups the pickup request into it', async () => {
    await transportPage.goto('/transport/trips');
    await transportPage.getByRole('button', { name: 'رحلة جديدة' }).click();
    await transportPage.locator('#trip-driver').selectOption(driverId);
    await transportPage.locator('#trip-vehicle').selectOption(vehicleId);
    await transportPage.locator('#trip-facility').selectOption(facilityId);
    await transportPage.locator('#trip-waste-stream').selectOption(WASTE_STREAM);
    await transportPage.getByRole('button', { name: 'إنشاء' }).click();

    await expect(async () => {
      const { data: trip } = await admin
        .from('trips').select('id').eq('transport_company_id', transport.transportCompanyId)
        .order('created_at', { ascending: false }).limit(1).maybeSingle<{ id: string }>();
      expect(trip).toBeTruthy();
      tripId = trip!.id;
    }).toPass({ timeout: 10_000 });

    await transportPage.getByRole('button', { name: 'طلبات الالتقاط' }).click();
    await transportPage.getByRole('button', { name: 'إضافة' }).click();
    await expect(transportPage.getByText('لا توجد طلبات التقاط بانتظار التجميع')).toBeVisible({ timeout: 10_000 });
    await transportPage.getByText('إغلاق', { exact: true }).click(); // the visible-text Close button, not the Modal's icon-only "X"

    const { data: linked } = await admin.from('pickup_assignments').select('trip_id').eq('id', assignmentId).single<{ trip_id: string | null }>();
    expect(linked?.trip_id).toBe(tripId);
  });

  let branchQrToken = '';
  await test.step("company owner opens the branch's rotating QR board and captures a real signed token", async () => {
    await companyPage.goto('/company/branches');
    const qrResponsePromise = companyPage.waitForResponse((r) => r.url().includes(`/branches/${branchId}/qr`) && r.request().method() === 'POST');
    await companyPage.getByRole('button', { name: 'رمز QR للفرع' }).click();
    const qrResponse = await qrResponsePromise;
    const qrJson = (await qrResponse.json()) as { token: string };
    branchQrToken = qrJson.token;
    expect(branchQrToken).toBeTruthy();
  });

  const driverCtx = await browser.newContext({
    permissions: ['geolocation'],
    geolocation: { latitude: BRANCH_LAT, longitude: BRANCH_LNG, accuracy: 5 },
  });
  const driverPage = await driverCtx.newPage();
  let pickupEventId = '';

  await test.step('driver logs in and executes the pickup: real branch QR (manual entry), real geofence, real evidence, real signature', async () => {
    await driverPage.goto('/login');
    await driverPage.locator('#login-identifier').fill(driverLoginEmail);
    await driverPage.locator('#login-password').fill('DriverTemp1234!');
    await driverPage.getByRole('button', { name: 'تسجيل الدخول' }).click();
    await expect(driverPage).toHaveURL(/\/driver/);

    await driverPage.getByRole('button', { name: 'بدء الالتقاط' }).click();

    // QR: manual-entry fallback is proactively offered, not gated behind a
    // camera failure (src/components/driver/QRScanner.tsx) — no camera
    // permission grant needed at all.
    await driverPage.getByRole('button', { name: 'إدخال يدوي' }).click();
    // Same unassociated-Label gap as the branch form above.
    await driverPage.locator('label:text-is("رمز المنشأة") + input').fill(branchQrToken);
    // "تأكيد" also substring-matches a bottom-nav "تأكيد التسليم" tab.
    await driverPage.getByRole('button', { name: 'تأكيد', exact: true }).click();

    // Geofence: this context's geolocation was mocked to the branch's exact
    // coordinates at creation — no manual coordinate input exists in the UI.
    await expect(driverPage.getByRole('button', { name: 'المتابعة إلى البيان الرقمي' })).toBeEnabled({ timeout: 15_000 });
    await driverPage.getByRole('button', { name: 'المتابعة إلى البيان الرقمي' }).click();

    // Digital manifest
    await driverPage.getByRole('button', { name: 'نفايات بلاستيكية' }).click();
    for (const digit of PICKUP_WEIGHT_KG.split('')) {
      await driverPage.getByRole('button', { name: digit, exact: true }).click();
    }
    await expect(driverPage.getByText(PICKUP_WEIGHT_KG, { exact: true })).toBeVisible();

    // CameraCapture falls back to a hidden <input type=file capture=environment>
    // when getUserMedia is unavailable/denied (no permission granted in this
    // context) — setInputFiles fires the same onChange path a real capture would.
    const cameraFallbackInputs = driverPage.locator('input[type="file"][capture="environment"]');
    await cameraFallbackInputs.nth(0).setInputFiles({ name: 'pickup-photo.jpg', mimeType: 'image/jpeg', buffer: TINY_JPEG });
    await cameraFallbackInputs.nth(1).setInputFiles({ name: 'scale-photo.jpg', mimeType: 'image/jpeg', buffer: TINY_JPEG });
    await expect(driverPage.getByText('تم التقاط الصورة')).toBeVisible();
    await expect(driverPage.getByText('تم تصوير الميزان')).toBeVisible();

    await driverPage.getByRole('button', { name: 'إكمال الالتقاط' }).click();

    // Signature pad: real canvas mouse-drag.
    const canvas = driverPage.locator('canvas');
    const box = (await canvas.boundingBox())!;
    await driverPage.mouse.move(box.x + 20, box.y + 20);
    await driverPage.mouse.down();
    await driverPage.mouse.move(box.x + 100, box.y + 60);
    await driverPage.mouse.move(box.x + 180, box.y + 20);
    await driverPage.mouse.up();
    await driverPage.getByRole('button', { name: 'تأكيد التوقيع' }).click();

    // Confirmation auto-submits on mount.
    await expect(driverPage.getByText('تم بنجاح!')).toBeVisible({ timeout: 20_000 });
    await driverPage.getByRole('button', { name: 'العودة للرئيسية' }).click();
  });

  await test.step('DB check: the pickup event was recorded compliant, linked to the trip', async () => {
    await expect(async () => {
      const { data: event } = await admin
        .from('pickup_events').select('id, weight_kg, compliance_status')
        .eq('trip_id', tripId).order('created_at', { ascending: false }).limit(1)
        .maybeSingle<{ id: string; weight_kg: number; compliance_status: string }>();
      expect(event).toBeTruthy();
      pickupEventId = event!.id;
      expect(Number(event!.weight_kg)).toBe(Number(PICKUP_WEIGHT_KG));
      expect(event!.compliance_status).not.toBe('non_compliant');
    }).toPass({ timeout: 10_000 });
  });

  await test.step('driver advances the trip to the facility (Start Trip -> Arrived)', async () => {
    await driverPage.goto('/driver/deliveries');
    await driverPage.getByRole('button', { name: 'بدء الرحلة' }).click();
    await expect(driverPage.getByRole('button', { name: 'وصلت للمنشأة' })).toBeVisible({ timeout: 10_000 });
    await driverPage.getByRole('button', { name: 'وصلت للمنشأة' }).click();
    await expect(driverPage.getByText('بانتظار التأكيد')).toBeVisible({ timeout: 10_000 });
  });

  const recyclerCtx = await browser.newContext();
  const recyclerPage = await recyclerCtx.newPage();

  await test.step('scale operator confirms the drop-off with a matching net weight (no QR scan needed — Record Weight works directly off the inbound list)', async () => {
    await recyclerPage.goto('/login');
    await recyclerPage.locator('#login-identifier').fill(scaleOperatorEmail);
    await recyclerPage.locator('#login-password').fill(PASSWORD);
    await recyclerPage.getByRole('button', { name: 'تسجيل الدخول' }).click();
    await expect(recyclerPage).toHaveURL(/\/recycler/);

    await recyclerPage.getByRole('button', { name: 'تسجيل الوزن' }).click();
    // Same unassociated-Label gap (this one also has a trailing " *").
    await recyclerPage.locator('label:has-text("الوزن الصافي (كجم)") + input').fill(PICKUP_WEIGHT_KG);

    const weighbridgeInput = recyclerPage.locator('input[type="file"][capture="environment"]');
    await weighbridgeInput.setInputFiles({ name: 'weighbridge.jpg', mimeType: 'image/jpeg', buffer: TINY_JPEG });
    await expect(recyclerPage.getByText('تم التقاط صورة الميزان')).toBeVisible();

    await recyclerPage.getByRole('button', { name: 'إرسال' }).click();
    await expect(recyclerPage.getByText('لا توجد رحلات بانتظار التأكيد')).toBeVisible({ timeout: 10_000 });
  });

  await test.step('DB + UI check: weight reconciliation is within tolerance, trip is reconciled', async () => {
    await expect(async () => {
      const { data: trip } = await admin
        .from('trips').select('status, weight_reconciliation_status, reconciled_net_weight_kg, reconciled_pickup_weight_kg')
        .eq('id', tripId).single<{
          status: string; weight_reconciliation_status: string;
          reconciled_net_weight_kg: number; reconciled_pickup_weight_kg: number;
        }>();
      expect(trip?.status).toBe('reconciled');
      expect(trip?.weight_reconciliation_status).toBe('within_tolerance');
      expect(Number(trip?.reconciled_net_weight_kg)).toBe(Number(PICKUP_WEIGHT_KG));
      expect(Number(trip?.reconciled_pickup_weight_kg)).toBe(Number(PICKUP_WEIGHT_KG));
    }).toPass({ timeout: 10_000 });

    // UI truth: TransportTripsPage shows a mismatch warning ONLY when
    // flagged — assert it's absent for this within-tolerance trip.
    await transportPage.goto('/transport/trips');
    await expect(transportPage.getByText('⚠ فرق وزن يتجاوز الحد المسموح')).toHaveCount(0);
    await expect(transportPage.getByText('مطابق')).toBeVisible();
  });

  await test.step('company owner downloads the single-pickup inspection PDF and verifies its sha256 + content', async () => {
    await companyPage.goto('/company');
    // The button's own handler does window.open(result.signed_url, ...) —
    // rather than chase the popup Page's .url() (fires empty at the instant
    // the 'popup' event itself fires, a known Playwright race with noopener
    // popups; first attempt at this silently fetched the app's OWN
    // index.html and hashed THAT — same wrong hash every run regardless of
    // real PDF content, which is what gave it away), capture the real
    // signed_url straight from the network response the button's own code
    // already makes.
    const responsePromise = companyPage.waitForResponse((r) => r.url().includes('/generate/single-pickup') && r.request().method() === 'POST');
    const popupPromise = companyPage.waitForEvent('popup');
    await companyPage.getByRole('button', { name: 'إنشاء ملف التفتيش' }).click();
    const [response, popup] = await Promise.all([responsePromise, popupPromise]);
    const { signed_url: pdfUrl } = (await response.json()) as { signed_url: string };
    await popup.close();

    const res = await companyPage.request.get(pdfUrl);
    expect(res.ok()).toBe(true);
    const bytes = await res.body();
    const sha256 = createHash('sha256').update(bytes).digest('hex');

    const { data: inspectionPdf } = await admin
      .from('inspection_pdfs').select('sha256_hash')
      .eq('company_id', company.companyId)
      .eq('pickup_event_id', pickupEventId)
      .eq('report_type', 'single_pickup')
      .order('created_at', { ascending: false }).limit(1)
      .single<{ sha256_hash: string }>();
    expect(sha256).toBe(inspectionPdf!.sha256_hash);

    const text = await extractPdfText(bytes);
    expect(text).toContain(VEHICLE_PLATE);
  });

  await test.step('company owner downloads the All-Branches pack and verifies its sha256', async () => {
    const responsePromise = companyPage.waitForResponse((r) => r.url().includes('/generate/monthly-company') && r.request().method() === 'POST');
    const popupPromise = companyPage.waitForEvent('popup');
    await companyPage.getByRole('button', { name: 'تقرير جميع الفروع' }).click();
    const [response, popup] = await Promise.all([responsePromise, popupPromise]);
    const { signed_url: pdfUrl } = (await response.json()) as { signed_url: string };
    await popup.close();

    const res = await companyPage.request.get(pdfUrl);
    expect(res.ok()).toBe(true);
    const bytes = await res.body();
    const sha256 = createHash('sha256').update(bytes).digest('hex');

    const { data: inspectionPdf } = await admin
      .from('inspection_pdfs').select('sha256_hash')
      .eq('company_id', company.companyId)
      .eq('report_type', 'monthly_company')
      .order('created_at', { ascending: false }).limit(1)
      .single<{ sha256_hash: string }>();
    expect(sha256).toBe(inspectionPdf!.sha256_hash);

    const text = await extractPdfText(bytes);
    // pdf-parse extracts Arabic RTL text in PDF logical (glyph-shaping)
    // order, not visual reading order — a long Arabic string like
    // BRANCH_NAME reliably comes out scrambled/line-wrapped and can't be
    // substring-matched (confirmed empirically; same caveat the existing
    // src/lib/__tests__/phase2-acceptance.test.ts documents). Assert an
    // ASCII/numeric token instead, same convention that test already uses.
    expect(text).toContain(COMPANY_CR);
  });

  await companyCtx.close();
  await transportCtx.close();
  await driverCtx.close();
  await recyclerCtx.close();
});
