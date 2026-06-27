-- ═══════════════════════════════════════════════════════════════════════════
-- Sanad 360 – Migration 006: Branch Write Grants (prelaunch bugfix)
-- ═══════════════════════════════════════════════════════════════════════════
-- BUG: Creating a branch failed with "permission denied for table branches"
-- (SQLSTATE 42501). Migration 001 defined RLS policies branches_insert /
-- branches_update (allowing owner/manager of the same company) but only ever
-- granted SELECT on the table to `authenticated`. Table-level privileges are
-- checked BEFORE row-level policies, so every INSERT/UPDATE was rejected at the
-- GRANT layer and the RLS policies were never reachable.
--
-- FIX: grant INSERT + UPDATE on public.branches to `authenticated`. RLS
-- (branches_insert WITH CHECK / branches_update USING) still scopes writes to
-- the caller's own company and to owner/manager roles. No DELETE is granted —
-- deletes are soft (status='inactive') via UPDATE, keeping history intact.
-- ═══════════════════════════════════════════════════════════════════════════

GRANT INSERT, UPDATE ON public.branches TO authenticated;
