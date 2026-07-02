// One-off screenshot harness for the finish-line polish review.
// Run from services/pdf (playwright lives here): node screenshots.mjs
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = 'http://localhost:5173';
const OUT = '../test-output/screenshots';
mkdirSync(OUT, { recursive: true });

const DESKTOP = { width: 1280, height: 800 };
const MOBILE = { width: 390, height: 844 };

async function login(page) {
  await page.goto(`${BASE}/login`);
  await page.click('[role="tab"]:has(#company-tab), [role="tab"] >> nth=1').catch(() => {});
  // Radix tabs: click the second trigger (company)
  const triggers = page.locator('[role="tab"]');
  await triggers.nth(1).click();
  await page.fill('#company-email', 'manager@sanad360.dev');
  await page.fill('#company-password', 'DevPass1234!');
  // Submit via Enter (the login control is a custom InteractiveButton, not type=submit)
  await page.press('#company-password', 'Enter');
  await page.waitForURL('**/company', { timeout: 20000 });
}

async function toggleToEnglish(page) {
  // Topbar globe button shows "English" while in AR
  await page.click('button:has-text("English")');
  await page.waitForTimeout(400);
}

async function shoot(page, name) {
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false });
  console.log(`✓ ${name}.png`);
}

async function captureFor(viewport, tag) {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  await login(page);

  // ── Review queue (AR default) ──
  await page.goto(`${BASE}/company/review`);
  await page.waitForSelector('h1', { timeout: 15000 });
  await page.waitForTimeout(1200);
  await shoot(page, `review-queue-ar-${tag}`);

  // ── Branch QR modal (AR) ──
  await page.goto(`${BASE}/company/branches`);
  await page.waitForSelector('h1', { timeout: 15000 });
  await page.waitForTimeout(1200);
  await page.locator('button[title="رمز QR للفرع"]').first().click();
  await page.waitForSelector('img[alt="Branch QR"]', { timeout: 10000 });
  await shoot(page, `branch-qr-modal-ar-${tag}`);

  // ── Print view (AR): intercept the popup, block the print dialog ──
  const [popup] = await Promise.all([
    context.waitForEvent('page'),
    (async () => {
      await page.evaluate(() => {
        // Neutralize window.print in pages opened from here
        const orig = window.open;
        window.open = (...args) => {
          const w = orig.apply(window, args);
          if (w) w.print = () => {};
          return w;
        };
      });
      await page.click('button:has-text("طباعة")');
    })(),
  ]);
  await popup.waitForLoadState('domcontentloaded');
  await popup.setViewportSize({ width: 800, height: 1100 });
  await popup.waitForTimeout(800);
  await popup.screenshot({ path: `${OUT}/branch-qr-print-ar-${tag}.png` });
  console.log(`✓ branch-qr-print-ar-${tag}.png`);
  await popup.close();
  // Close modal
  await page.keyboard.press('Escape').catch(() => {});
  await page.locator('button:has(svg.lucide-x)').first().click().catch(() => {});

  // ── English pass ──
  // isRTL is in-memory Zustand state: a full page.goto reloads the app and
  // resets it to Arabic, so toggle AFTER landing on each page.
  await page.goto(`${BASE}/company/review`);
  await page.waitForSelector('h1', { timeout: 15000 });
  await toggleToEnglish(page);
  await page.waitForTimeout(1200);
  await shoot(page, `review-queue-en-${tag}`);

  await page.goto(`${BASE}/company/branches`);
  await page.waitForSelector('h1', { timeout: 15000 });
  await toggleToEnglish(page);
  await page.waitForTimeout(1200);
  await page.locator('button[title="Branch QR board"]').first().click();
  await page.waitForSelector('img[alt="Branch QR"]', { timeout: 10000 });
  await shoot(page, `branch-qr-modal-en-${tag}`);

  await browser.close();
}

await captureFor(DESKTOP, 'desktop');
await captureFor(MOBILE, 'mobile');
console.log('done');
