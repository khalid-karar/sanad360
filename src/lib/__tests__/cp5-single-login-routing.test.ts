/**
 * Single-form login: no role tabs, server-resolved routing (CP5 4a)
 *
 * LoginPage.tsx no longer has a driver/company/transport/admin tab picker —
 * one email-or-phone + password form for every role, backed by
 * src/lib/roleRouting.ts's resolveLoginEmail() + homeRouteFor(), which is
 * exactly what this test exercises end-to-end against a REAL sign-in (not a
 * component render — this repo has no component-test harness; see
 * review-queue.test.ts's note on relying on integration-level assertions
 * instead of introducing a first-of-its-kind pattern for one page).
 *
 * Assertions:
 *   1. resolveLoginEmail() converts a bare phone number to the synthetic
 *      driver email; passes an email straight through unchanged
 *   2. A driver typing their bare phone number into the single form
 *      (resolveLoginEmail + signInWithPassword, the exact sequence
 *      LoginPage.handleLogin runs) authenticates successfully as the
 *      seeded driver, and homeRouteFor() sends them to /driver
 *   3. The same single form, given an email identifier, authenticates a
 *      manager and homeRouteFor() sends them to /company — proving one
 *      code path serves both without any client-side role selection
 */

import { createClient } from '@supabase/supabase-js';
import { describe, it, expect } from 'vitest';
import { resolveLoginEmail, homeRouteFor } from '../roleRouting';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY ?? '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

if (!ANON_KEY || !SERVICE_KEY) {
  throw new Error('Set VITE_SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY in .env.');
}

const anon = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });

const SEED = {
  driverPhone: '0501234567',
  driverPassword: 'DevPass1234!',
  managerEmail: 'manager@sanad360.dev',
  managerPassword: 'DevPass1234!',
};

describe('Single-form login: no role tabs, server-resolved routing (CP5 4a)', () => {
  it('1. resolveLoginEmail: bare phone → synthetic driver email; an email passes through unchanged', () => {
    expect(resolveLoginEmail('0501234567')).toBe('0501234567@driver.sanad360.com');
    expect(resolveLoginEmail(' 0501234567 ')).toBe('0501234567@driver.sanad360.com');
    expect(resolveLoginEmail('manager@sanad360.dev')).toBe('manager@sanad360.dev');
  });

  it('2. a driver typing their bare phone number into the single form authenticates and lands on /driver', async () => {
    const email = resolveLoginEmail(SEED.driverPhone);
    const { data, error } = await anon.auth.signInWithPassword({ email, password: SEED.driverPassword });
    expect(error).toBeNull();
    expect(data.session).not.toBeNull();

    const { data: membership } = await anon
      .from('memberships')
      .select('role, company_id, transport_company_id, branch_id')
      .eq('user_id', data.user!.id)
      .is('revoked_at', null)
      .order('created_at', { ascending: true })
      .limit(1)
      .single<{ role: string; company_id: string | null; transport_company_id: string | null; branch_id: string | null }>();
    expect(membership?.role).toBe('driver');
    expect(homeRouteFor({ role: 'driver', transport_company_id: membership!.transport_company_id })).toBe('/driver');

    await anon.auth.signOut({ scope: 'local' });
  });

  it('3. the same single form, given an email identifier, authenticates a manager and lands on /company', async () => {
    const email = resolveLoginEmail(SEED.managerEmail);
    expect(email).toBe(SEED.managerEmail);
    const { data, error } = await anon.auth.signInWithPassword({ email, password: SEED.managerPassword });
    expect(error).toBeNull();
    expect(data.session).not.toBeNull();

    const { data: membership } = await anon
      .from('memberships')
      .select('role, company_id, transport_company_id')
      .eq('user_id', data.user!.id)
      .is('revoked_at', null)
      .order('created_at', { ascending: true })
      .limit(1)
      .single<{ role: string; company_id: string | null; transport_company_id: string | null }>();
    expect(membership?.role).toBe('manager');
    expect(homeRouteFor({ role: 'manager', transport_company_id: membership!.transport_company_id })).toBe('/company');

    await anon.auth.signOut({ scope: 'local' });
  });
});
