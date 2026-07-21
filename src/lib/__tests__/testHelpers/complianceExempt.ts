/**
 * CP2 (migration 021) grandfathers pre-existing drivers/vehicles via a
 * one-time `compliance_exempt` backfill at migration time — by design, no
 * client path (not even service_role through PostgREST) can ever set that
 * column afterwards; drivers_lock_compliance_exempt_trigger /
 * vehicles_lock_compliance_exempt_trigger pin it to false on INSERT and to
 * OLD on UPDATE unconditionally.
 *
 * Test files predating CP2 create throwaway drivers/vehicles via
 * service_role purely to exercise unrelated features (risk scoring,
 * evidence hashing, PDPL erasure, ...) and then insert a pickup_event or
 * pickup_assignment against them. Those fixtures are now, correctly,
 * treated as "new" by the document gate and blocked — CP2 was never meant
 * to entangle itself with those tests' fixtures, so this helper reproduces
 * exactly what a real deployment of 021 would have done to a pre-existing
 * row (disable the lock trigger, flip the column, re-enable it) via direct
 * SQL against the same local Postgres container every RLS test in this
 * suite already depends on.
 */
import { execFileSync } from 'node:child_process';

const DB_CONTAINER = process.env.SUPABASE_DB_CONTAINER ?? 'supabase_db_sanad360';

export function grandfatherCompliance(kind: 'driver' | 'vehicle', id: string): boolean {
  const table = kind === 'driver' ? 'drivers' : 'vehicles';
  const trigger = kind === 'driver'
    ? 'drivers_lock_compliance_exempt_trigger'
    : 'vehicles_lock_compliance_exempt_trigger';
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
