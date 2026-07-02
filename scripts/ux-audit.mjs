// UX audit harness: walks every role's key screens at desktop + mobile,
// Arabic (default) + English, and captures screenshots for the design review.
// Run from services/pdf (playwright lives there):  node ../../scripts/ux-audit.mjs
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const BASE = 'http://localhost:5173';
const OUT = resolve(process.cwd(), process.env.AUDIT_OUT ?? '../../test-output/ux-audit');
mkdirSync(OUT, { recursive: true });

const VIEWPORTS = {
  desktop: { width: 1280, height: 800 },
  mobile: { width: 375, height: 812 },
};

const ROLES = {
  manager: {
    tab: 1,
    fields: { user: '#company-email', pass: '#company-password' },
    creds: { user: 'manager@sanad360.dev', pass: 'DevPass1234!' },
    landing: '**/company',
    pages: [
      ['company-dashboard', '/company'],
      ['company-branches', '/company/branches'],
      ['company-pickups', '/company/pickups'],
      ['company-schedule', '/company/schedule'],
      ['company-review', '/company/review'],
      ['company-transporters', '/company/transporters'],
    ],
  },
  driver: {
    tab: 0,
    fields: { user: '#driver-phone', pass: '#driver-password' },
    creds: { user: '0501234567', pass: 'DevPass1234!' },
    landing: '**/driver',
    pages: [
      ['driver-awaiting', '/driver'],
      ['driver-schedule', '/driver/schedule'],
      ['driver-deliveries', '/driver/deliveries'],
    ],
  },
  transport: {
    tab: 2,
    fields: { user: '#transport-email', pass: '#transport-password' },
    creds: { user: 'dispatcher@sanad360.dev', pass: 'DevPass1234!' },
    landing: '**/transport',
    pages: [
      ['transport-dashboard', '/transport'],
      ['transport-drivers', '/transport/drivers'],
      ['transport-vehicles', '/transport/vehicles'],
    ],
  },
  admin: {
    tab: 3,
    fields: { user: '#admin-email', pass: '#admin-password' },
    creds: { user: 'admin@sanad360.dev', pass: 'DevPass1234!' },
    landing: '**/admin',
    pages: [
      ['admin-dashboard', '/admin'],
      ['admin-companies', '/admin/companies'],
      ['admin-users', '/admin/users'],
    ],
  },
};

async function login(page, role) {
  await page.goto(`${BASE}/login`);
  await page.locator('[role="tab"]').nth(role.tab).click();
  await page.fill(role.fields.user, role.creds.user);
  await page.fill(role.fields.pass, role.creds.pass);
  await page.press(role.fields.pass, 'Enter');
  await page.waitForURL(role.landing, { timeout: 20000 });
}

async function toEnglish(page) {
  await page.locator('button:has-text("English")').first().click({ timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(400);
}

async function shoot(page, name) {
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log(`✓ ${name}`);
}

for (const [vpName, viewport] of Object.entries(VIEWPORTS)) {
  const browser = await chromium.launch();

  // Login page itself (both languages, no auth)
  {
    const page = await (await browser.newContext({ viewport })).newPage();
    await page.goto(`${BASE}/login`);
    await shoot(page, `login-ar-${vpName}`);
    await toEnglish(page);
    await shoot(page, `login-en-${vpName}`);
    await page.context().close();
  }

  for (const [roleName, role] of Object.entries(ROLES)) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    try {
      await login(page, role);
      for (const [name, path] of role.pages) {
        await page.goto(`${BASE}${path}`);
        await page.waitForTimeout(1500);
        await shoot(page, `${name}-ar-${vpName}`);
        await toEnglish(page);
        await shoot(page, `${name}-en-${vpName}`);
        // language resets on next goto (full reload) — AR again automatically
      }

      // Driver only: walk into the evidence flow (QR scan will show the
      // no-camera fallback, itself an audit target), then manifest.
      if (roleName === 'driver') {
        await page.goto(`${BASE}/driver`);
        await page.waitForTimeout(1500);
        const start = page.locator('button', { hasText: /بدء الالتقاط|متابعة الالتقاط/ }).first();
        if (await start.count()) {
          await start.click();
          await page.waitForTimeout(2500);
          await shoot(page, `driver-qr-ar-${vpName}`);
          // Manual entry path → geolocation step
          await page.locator('button', { hasText: 'إدخال يدوي' }).click().catch(() => {});
          await page.waitForTimeout(400);
          await shoot(page, `driver-qr-manual-ar-${vpName}`);
          await page.locator('input').first().fill('TEST-QR');
          await page.locator('button', { hasText: 'تأكيد' }).click().catch(() => {});
          await page.waitForTimeout(2000);
          await shoot(page, `driver-gps-ar-${vpName}`);
          await page.locator('button', { hasText: 'المتابعة إلى البيان الرقمي' }).click().catch(() => {});
          await page.waitForTimeout(800);
          await shoot(page, `driver-manifest-ar-${vpName}`);
          // fill weight to see enabled state, then signature pad
          await page.locator('button', { hasText: /^نفايات عضوية$/ }).click().catch(() => {});
          for (const key of ['4', '2']) {
            await page.locator('button', { hasText: new RegExp(`^${key}$`) }).first().click().catch(() => {});
          }
          await shoot(page, `driver-manifest-filled-ar-${vpName}`);
          await page.locator('button', { hasText: 'إكمال الالتقاط' }).click().catch(() => {});
          await page.waitForTimeout(800);
          await shoot(page, `driver-signature-ar-${vpName}`);
        }
      }
    } catch (err) {
      console.error(`✗ ${roleName}-${vpName}: ${err.message}`);
    }
    await context.close();
  }
  await browser.close();
}
console.log('audit capture done →', OUT);
