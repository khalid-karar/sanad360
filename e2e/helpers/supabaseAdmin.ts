import { createClient } from '@supabase/supabase-js';

/**
 * service_role client for e2e/ journeys — used ONLY to directly verify
 * server-side outcomes a real applicant/reviewer/etc. browser session
 * couldn't itself observe (e.g. that a re-parented document kept its row id,
 * or that an audit_log row was written), never to drive the flow itself.
 * Every user-facing action in these journeys goes through the real UI.
 * Same env vars as the vitest integration suite (src/lib/__tests__/*.test.ts).
 */
const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
if (!SERVICE_KEY) {
  throw new Error('Set SUPABASE_SERVICE_ROLE_KEY (see .env.example) to run the e2e journeys — needed for fixture verification.');
}

export const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
