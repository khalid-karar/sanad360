import { defineConfig, devices } from '@playwright/test';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// Same manual .env loader as src/test-setup.ts (Vitest's setupFiles hook) —
// no dotenv dependency in this repo, and we need un-prefixed vars like
// SUPABASE_SERVICE_ROLE_KEY for e2e/'s direct-DB verification helpers, which
// Vite's own VITE_-only env exposure wouldn't give us anyway (this is a
// plain Node process, not a Vite one).
try {
  const content = readFileSync(resolve(process.cwd(), '.env'), 'utf-8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.substring(0, eqIdx).trim();
    const val = trimmed.substring(eqIdx + 1).trim();
    if (key && !(key in process.env)) process.env[key] = val;
  }
} catch {
  // No .env file — vars must be injected externally (CI, etc.)
}

/**
 * CP8 Slice E — browser E2E infra, first stood up in this repo.
 *
 * webServer runs against the PRODUCTION build (`vite preview` serving
 * `dist/`), never the dev server — the whole point of this layer is
 * catching real integration bugs (routing, asset paths, env baked into the
 * build), not dev-server-only behavior. `dist/` must already exist before
 * `playwright test` runs (`npm run build` first) — this config deliberately
 * does NOT build automatically inside webServer.command, so CI's existing
 * "Build (frontend)" step is the single source of the artifact under test,
 * not a second, possibly-different build triggered here.
 *
 * Browser binaries: installed via `PLAYWRIGHT_BROWSERS_PATH` pointed at a
 * directory distinct from services/pdf's own Chromium cache (that one is
 * the plain `playwright` package, used for PDF rendering, cached under
 * `~/.cache/ms-playwright` in CI) — kept separate so the two GitHub Actions
 * cache steps never collide on the same key/path for two different
 * Chromium builds.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [['html', { open: 'never' }], ['list']] : 'list',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    // --host 127.0.0.1 is load-bearing, not decoration: `vite preview`
    // otherwise binds `localhost`, which some hosts (confirmed on this dev
    // machine) resolve to the IPv6 loopback ONLY — Playwright's health
    // check against the IPv4 url below then times out waiting for a server
    // that's actually already up, just on the other address family.
    command: 'npm run preview -- --port 4173 --strictPort --host 127.0.0.1',
    url: 'http://127.0.0.1:4173',
    // CI always starts a fresh server against the just-built dist/; local
    // runs may reuse one already running (fast iteration).
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
