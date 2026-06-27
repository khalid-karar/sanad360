import { createClient } from '@supabase/supabase-js';

// Accept either the unprefixed server vars or the VITE_-prefixed ones so the
// service can run off the same root .env as the frontend (loaded by env.ts).
const supabaseUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const anonKey = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
}

// Service-role client: bypasses RLS, used for all DB reads + storage writes.
// Authorization is enforced in the route middleware — not via RLS.
export const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false },
});

// Anon client: used ONLY to validate a caller's JWT via auth.getUser(jwt).
// Never used for privileged operations. Falls back to the service client's URL.
export const anon = anonKey
  ? createClient(supabaseUrl, anonKey, { auth: { persistSession: false } })
  : null;
