import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
}

// Service-role client: bypasses RLS, used for all DB reads + storage writes.
// Authorization is enforced in the route middleware — not via RLS.
export const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false },
});
