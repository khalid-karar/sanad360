import { execFileSync } from 'node:child_process';
import { admin } from './supabaseAdmin';

const PASSWORD = 'DevPass1234!';
const DB_CONTAINER = process.env.SUPABASE_DB_CONTAINER ?? 'supabase_db_sanad360';

/**
 * Mirrors src/lib/__tests__/testHelpers/complianceExempt.ts exactly (same
 * disable-trigger/update/enable-trigger dance a real deployment of migration
 * 021/042 would have done to a pre-existing row) — duplicated here rather
 * than cross-imported because that helper lives under the vitest suite's
 * own test-internals path, not a shared library boundary.
 *
 * Used ONLY for the company/transport_company tenants this journey starts
 * from — CP8 Slice F already proved the real self-service onboarding UI
 * (signup -> verify -> upload -> review -> approve) end to end; re-driving
 * it here would just slow this test down without covering new ground. This
 * slice's OWN new ground (branch/driver/vehicle/facility/trip/QR/geofence/
 * evidence/weighbridge/reconciliation/PDF) gets the real browser treatment.
 */
function grandfatherCompliance(kind: 'company' | 'transport_company', id: string): void {
  const table = kind === 'company' ? 'companies' : 'transport_companies';
  const trigger = `${table}_lock_compliance_exempt_trigger`;
  execFileSync('docker', [
    'exec', DB_CONTAINER, 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-c',
    `ALTER TABLE public.${table} DISABLE TRIGGER ${trigger}; ` +
    `UPDATE public.${table} SET compliance_exempt = true WHERE id = '${id}'; ` +
    `ALTER TABLE public.${table} ENABLE TRIGGER ${trigger};`,
  ], { stdio: 'pipe' });
}

export interface TenantFixture {
  ownerEmail: string;
  ownerUserId: string;
  password: string;
}

/** A pre-approved, grandfathered company + its real owner login. */
export async function createCompanyTenant(runId: number): Promise<TenantFixture & { companyId: string }> {
  const email = `e2e-g-company-owner-${runId}@sanad360.dev`;
  const { data: authUser, error: authErr } = await admin.auth.admin.createUser({
    email, password: PASSWORD, email_confirm: true,
  });
  if (authErr || !authUser.user) throw new Error(`createUser (company owner) failed: ${authErr?.message}`);
  const ownerUserId = authUser.user.id;
  await admin.from('profiles').upsert({ id: ownerUserId, name_ar: 'مالك الشركة' }, { onConflict: 'id' });

  const { data: company, error: companyErr } = await admin
    .from('companies')
    .insert({ name_ar: `شركة السلسلة التشغيلية ${runId}`, commercial_registration: `E2EG${runId}` })
    .select('id')
    .single<{ id: string }>();
  if (companyErr || !company) throw new Error(`companies.insert failed: ${companyErr?.message}`);

  grandfatherCompliance('company', company.id);

  const { error: memErr } = await admin
    .from('memberships')
    .insert({ user_id: ownerUserId, role: 'owner', company_id: company.id });
  if (memErr) throw new Error(`memberships.insert (company owner) failed: ${memErr.message}`);

  return { companyId: company.id, ownerEmail: email, ownerUserId, password: PASSWORD };
}

/** A pre-approved, grandfathered transport company + its real owner login. */
export async function createTransportTenant(runId: number): Promise<TenantFixture & { transportCompanyId: string }> {
  const email = `e2e-g-transport-owner-${runId}@sanad360.dev`;
  const { data: authUser, error: authErr } = await admin.auth.admin.createUser({
    email, password: PASSWORD, email_confirm: true,
  });
  if (authErr || !authUser.user) throw new Error(`createUser (transport owner) failed: ${authErr?.message}`);
  const ownerUserId = authUser.user.id;
  await admin.from('profiles').upsert({ id: ownerUserId, name_ar: 'مالك شركة النقل' }, { onConflict: 'id' });

  const { data: tc, error: tcErr } = await admin
    .from('transport_companies')
    .insert({ name_ar: `شركة نقل السلسلة التشغيلية ${runId}`, commercial_registration: `E2EGT${runId}` })
    .select('id')
    .single<{ id: string }>();
  if (tcErr || !tc) throw new Error(`transport_companies.insert failed: ${tcErr?.message}`);

  grandfatherCompliance('transport_company', tc.id);

  const { error: memErr } = await admin
    .from('memberships')
    .insert({ user_id: ownerUserId, role: 'owner', transport_company_id: tc.id });
  if (memErr) throw new Error(`memberships.insert (transport owner) failed: ${memErr.message}`);

  return { transportCompanyId: tc.id, ownerEmail: email, ownerUserId, password: PASSWORD };
}

/**
 * A dispatcher account for an already-created transport tenant.
 *
 * No browser UI (or backend endpoint) exists for a transport owner to
 * invite a dispatcher/team member — confirmed via grep, only
 * /transport/invite-driver exists (that's for FLEET drivers, a different
 * concept: a `drivers` row gaining a linked login, not a new membership).
 * Real server-side seeding via service_role, same posture as facility
 * creation below — not a UI bypass, there is no UI to bypass. The LOGIN
 * and the assign-request ACTION (CP8 migration 044 separation of duties)
 * this dispatcher performs are both real UI, real RLS.
 */
export async function createDispatcherForTransport(
  transportCompanyId: string, runId: number
): Promise<TenantFixture> {
  const email = `e2e-g-dispatcher-${runId}@sanad360.dev`;
  const { data: authUser, error: authErr } = await admin.auth.admin.createUser({
    email, password: PASSWORD, email_confirm: true,
  });
  if (authErr || !authUser.user) throw new Error(`createUser (dispatcher) failed: ${authErr?.message}`);
  const ownerUserId = authUser.user.id;
  await admin.from('profiles').upsert({ id: ownerUserId, name_ar: 'موظف تنسيق النقل' }, { onConflict: 'id' });

  const { error: memErr } = await admin
    .from('memberships')
    .insert({ user_id: ownerUserId, role: 'dispatcher', transport_company_id: transportCompanyId });
  if (memErr) throw new Error(`memberships.insert (dispatcher) failed: ${memErr.message}`);

  return { ownerEmail: email, ownerUserId, password: PASSWORD };
}

/**
 * Facility creation has NO browser UI anywhere in this app (confirmed via
 * grep — /admin/facilities and /admin/invite-recycler are services/pdf HTTP
 * endpoints only, never wired to a React page). Real server-side action via
 * the seeded admin account's real session, same posture as any other
 * admin-only server action — not a browser-driven step because there is no
 * browser surface for it to drive.
 */
export async function adminAuthHeader(): Promise<Record<string, string>> {
  const { createClient } = await import('@supabase/supabase-js');
  const url = process.env.VITE_SUPABASE_URL ?? 'http://127.0.0.1:54321';
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY ?? '';
  const anon = createClient(url, anonKey, { auth: { persistSession: false } });
  const { data, error } = await anon.auth.signInWithPassword({ email: 'admin@sanad360.dev', password: PASSWORD });
  if (error || !data.session) throw new Error(`admin sign-in failed: ${error?.message}`);
  return { Authorization: `Bearer ${data.session.access_token}` };
}
