-- ═══════════════════════════════════════════════════════════════════════════
-- Sanad 360 – Migration 033: fix missing SELECT grant on branches.region_code
-- ═══════════════════════════════════════════════════════════════════════════
-- Bug found during CP7's BranchesPage reskin verification: migration 027
-- added branches.region_code and granted authenticated UPDATE (region_code)
-- ("additive to migration 023's lockdown") but never granted SELECT
-- (region_code) for the same column. Under Postgres column-level GRANTs,
-- selecting ANY column with no SELECT privilege fails the ENTIRE query with
-- 42501 — so branches.ts's BRANCH_COLUMNS (added in the same CP5 phase,
-- migration/app-code 4h) has been silently broken for every authenticated
-- caller ever since: any SELECT listing region_code alongside the other
-- branch columns (i.e. every real listBranches()/getBranch() call in the
-- app) errors out, surfacing as "Not authorized" in the UI.
--
-- This was never caught by the existing test suite because
-- cp5-regions-industries.test.ts only exercises a direct .update() on
-- region_code in isolation — no test previously called the real,
-- multi-column listBranches() against a branch with region_code included
-- in the select list. Confirmed reproducible via a real login + Playwright
-- session against a fresh `supabase db reset`, not a fluke/timing issue.
-- ═══════════════════════════════════════════════════════════════════════════

GRANT SELECT (region_code) ON public.branches TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- END OF MIGRATION 033
-- ═══════════════════════════════════════════════════════════════════════════
