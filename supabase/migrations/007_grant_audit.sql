-- ═══════════════════════════════════════════════════════════════════════════
-- Sanad 360 – Migration 007: Audit and fill missing table GRANTs
-- ═══════════════════════════════════════════════════════════════════════════
-- Root cause: PostgreSQL checks table-level GRANTs before RLS policies.
-- Tests using service_role bypass both layers and therefore missed these gaps.
-- This migration grants the minimum write privileges each authenticated write
-- path requires, matching the intent of the existing RLS policies.
--
-- AUDIT (authenticated role, ground truth from information_schema, pre-007):
--
--   table                   | SEL | INS | UPD | DEL | RLS write policy?      | gap
--   ------------------------+-----+-----+-----+-----+------------------------+----------
--   pickup_events           |  ✓  |  ✓  |  ✗  |  ✗  | insert (append-only)   | none
--   audit_log               |  ✓  |  ✗  |  ✗  |  ✗  | none (trigger-only)    | none
--   branches                |  ✓  |  ✓  |  ✓  |  ✗  | insert/update (006)    | fixed in 006
--   drivers                 |  ✓  |  ✗  |  ✗  |  ✗  | insert/update (001)    | INSERT,UPDATE ← FIX
--   vehicles                |  ✓  |  ✗  |  ✗  |  ✗  | insert/update (001)    | INSERT,UPDATE ← FIX
--   pickup_assignments      |  ✓  |  ✓  |  ✓  |  ✗  | insert/update (003)    | none
--   company_transporters    |  ✓  |  ✓  |  ✓  |  ✗  | insert/update (004)    | none
--   notifications           |  ✓  |  ✓  |  ✓  |  ✗  | insert/update (003)    | none
--   alert_acknowledgements  |  ✓  |  ✓  |  ✗  |  ✗  | insert (003)           | none
--   profiles                |  ✓  |  ✓  |  ✓  |  ✗  | update (001)           | none
--   inspection_pdfs         |  ✓  |  ✓  |  ✗  |  ✗  | insert (service_role)  | none
--   memberships             |  ✓  |  ✗  |  ✗  |  ✗  | none (service_role)    | none (correct)
--   companies               |  ✓  |  ✗  |  ✗  |  ✗  | none (service_role)    | none (correct)
--   transport_companies     |  ✓  |  ✗  |  ✗  |  ✗  | none (service_role)    | none (correct)
--
-- Only drivers and vehicles were missing grants: migration 001 defined the
-- drivers_insert / drivers_update / vehicles_insert / vehicles_update RLS
-- policies but only ever granted SELECT on those tables, so every transport
-- owner/manager createDriver / updateDriver / createVehicle / updateVehicle
-- write failed at the GRANT layer (42501) before RLS was ever consulted —
-- the exact pattern fixed for `branches` in 006.
--
-- GRANTs are idempotent: re-granting an existing privilege is a no-op, so this
-- migration is safe to re-run / re-apply.
-- ═══════════════════════════════════════════════════════════════════════════

-- drivers: INSERT + UPDATE — transport owner/manager(/dispatcher for INSERT)
-- manage their fleet drivers. RLS (drivers_insert WITH CHECK / drivers_update
-- USING) still scopes writes to the caller's own transport company and roles.
-- No DELETE — drivers are soft-deactivated (status='inactive') via UPDATE.
GRANT INSERT, UPDATE ON public.drivers  TO authenticated;

-- vehicles: INSERT + UPDATE — transport owner/manager manage their fleet
-- vehicles. RLS (vehicles_insert / vehicles_update) scopes writes to the
-- caller's own transport company. No DELETE — soft-deactivate via UPDATE.
GRANT INSERT, UPDATE ON public.vehicles TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- Already-correct grants (re-stated idempotently as documentation of intent).
-- These were granted in 001/003/004/006; listing them keeps the full authorized
-- write surface in one place and makes any future drift obvious.
-- ─────────────────────────────────────────────────────────────────────────────
GRANT INSERT          ON public.pickup_events         TO authenticated;  -- append-only ledger
GRANT INSERT, UPDATE  ON public.branches              TO authenticated;  -- 006
GRANT INSERT, UPDATE  ON public.pickup_assignments    TO authenticated;  -- 003
GRANT INSERT, UPDATE  ON public.company_transporters  TO authenticated;  -- 004
GRANT INSERT, UPDATE  ON public.notifications         TO authenticated;  -- 003
GRANT INSERT          ON public.alert_acknowledgements TO authenticated; -- 003
GRANT INSERT, UPDATE  ON public.profiles              TO authenticated;  -- 001

-- ═══════════════════════════════════════════════════════════════════════════
-- APPEND-ONLY / SERVICE-ROLE-ONLY — DO NOT GRANT (belt-and-suspenders)
-- ═══════════════════════════════════════════════════════════════════════════
-- Explicitly re-assert that authenticated/anon get NO mutating privileges on
-- the immutable ledger tables. 001 already REVOKEd these; we re-REVOKE so the
-- guarantee survives independent of migration ordering. UPDATE/DELETE on these
-- must NEVER be granted — the ledger and audit trail are append-only.
REVOKE UPDATE, DELETE ON public.pickup_events FROM authenticated, anon;
REVOKE UPDATE, DELETE ON public.audit_log     FROM authenticated, anon;
REVOKE INSERT         ON public.audit_log     FROM authenticated, anon;  -- trigger-only writes

-- companies / transport_companies / memberships are deliberately SELECT-only
-- for authenticated; all writes happen via service_role (platform onboarding).
-- No INSERT/UPDATE/DELETE is granted here, by design.

-- ═══════════════════════════════════════════════════════════════════════════
-- END OF MIGRATION 007
-- ═══════════════════════════════════════════════════════════════════════════
