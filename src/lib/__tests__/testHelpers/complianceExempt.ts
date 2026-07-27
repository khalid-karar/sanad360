/**
 * CP2 (migration 021) grandfathers pre-existing drivers/vehicles via a
 * one-time `compliance_exempt` backfill at migration time — by design, no
 * client path (not even service_role through PostgREST) can ever set that
 * column afterwards; drivers_lock_compliance_exempt_trigger /
 * vehicles_lock_compliance_exempt_trigger pin it to false on INSERT and to
 * OLD on UPDATE unconditionally. CP8 D2 (migration 042) repeats the exact
 * same pattern for companies/transport_companies (tenant-wide operational
 * blocking on the tenant's own required-document completion).
 *
 * Test files predating CP2 (or CP8 D2) create throwaway drivers/vehicles/
 * companies/transport_companies via service_role purely to exercise
 * unrelated features (risk scoring, evidence hashing, PDPL erasure, ...)
 * and then insert a pickup_event/pickup_assignment/trip against them.
 * Those fixtures are now, correctly, treated as "new" by the document gate
 * and blocked — CP2/CP8 were never meant to entangle themselves with those
 * tests' fixtures, so this helper reproduces exactly what a real deployment
 * of 021/042 would have done to a pre-existing row (disable the lock
 * trigger, flip the column, re-enable it) via direct SQL against the same
 * local Postgres container every RLS test in this suite already depends on.
 */
import { execFileSync } from 'node:child_process';

const DB_CONTAINER = process.env.SUPABASE_DB_CONTAINER ?? 'supabase_db_sanad360';

const TABLE: Record<string, string> = {
  driver: 'drivers',
  vehicle: 'vehicles',
  company: 'companies',
  transport_company: 'transport_companies',
};
const TRIGGER: Record<string, string> = {
  driver: 'drivers_lock_compliance_exempt_trigger',
  vehicle: 'vehicles_lock_compliance_exempt_trigger',
  company: 'companies_lock_compliance_exempt_trigger',
  transport_company: 'transport_companies_lock_compliance_exempt_trigger',
};

export function grandfatherCompliance(
  kind: 'driver' | 'vehicle' | 'company' | 'transport_company',
  id: string
): boolean {
  const table = TABLE[kind];
  const trigger = TRIGGER[kind];
  try {
    execFileSync('docker', [
      'exec', DB_CONTAINER, 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-c',
      `ALTER TABLE public.${table} DISABLE TRIGGER ${trigger}; ` +
      `UPDATE public.${table} SET compliance_exempt = true WHERE id = '${id}'; ` +
      `ALTER TABLE public.${table} ENABLE TRIGGER ${trigger};`,
    ], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}
