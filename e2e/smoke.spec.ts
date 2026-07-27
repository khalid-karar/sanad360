import { test, expect } from '@playwright/test';

/**
 * CP8 Slice E — the FIRST browser E2E test in this repo. Its only job is
 * proving the whole pipeline works end-to-end: production build -> vite
 * preview -> real Chromium -> real Supabase (baked into the build at build
 * time via VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY, must be reachable at
 * test-run time too, same as any authenticated journey would need) ->
 * assertion -> (on failure) trace/video artifacts. No real user journey is
 * built on this infra until this passes reliably.
 *
 * Bilingual: index.html hardcodes lang="ar" dir="rtl" as the pre-JS
 * default (App.tsx's own comment explains why — avoiding a flash of the
 * wrong direction before React mounts); App.tsx then keeps
 * document.documentElement.lang/dir in sync with the isRTL store on every
 * change. Language toggling is NOT persisted (no localStorage/cookie), so
 * every fresh page load starts Arabic regardless of test order — each
 * Playwright test additionally gets its own isolated browser context by
 * default, so there's no cross-test bleed either way.
 */

test.describe('smoke: unauthenticated /login renders bilingually', () => {
  test('Arabic (default, pre-toggle)', async ({ page }) => {
    await page.goto('/login');

    await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');

    await expect(page.getByText('سند 360')).toBeVisible();
    await expect(page.getByText('نظام إدارة النفايات والامتثال')).toBeVisible();
    await expect(page.getByLabel('البريد الإلكتروني أو رقم الهاتف')).toBeVisible();
    await expect(page.getByLabel('كلمة المرور')).toBeVisible();
    await expect(page.getByRole('button', { name: 'تسجيل الدخول' })).toBeVisible();

    // The toggle button OFFERS the other language — while Arabic is showing,
    // it reads "English".
    await expect(page.getByRole('button', { name: 'English' })).toBeVisible();
  });

  test('English (after toggling language)', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('button', { name: 'English' }).click();

    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');

    await expect(page.getByText('Sanad 360')).toBeVisible();
    await expect(page.getByText('Waste Management & Compliance System')).toBeVisible();
    await expect(page.getByLabel('Email or Phone Number')).toBeVisible();
    await expect(page.getByLabel('Password')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Login' })).toBeVisible();

    await expect(page.getByRole('button', { name: 'العربية' })).toBeVisible();
  });
});
