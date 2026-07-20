-- ═══════════════════════════════════════════════════════════════════════════
-- Sanad 360 – Migration 017: Recycler roles (enum values only)
-- ═══════════════════════════════════════════════════════════════════════════
-- Postgres will not let a newly added enum value be referenced by any DDL/DML
-- in the SAME migration transaction that adds it. This migration does nothing
-- but add the two new member_role values, so migration 018 (which creates
-- policies/CHECK logic that can reference 'recycler_manager' / 'scale_operator')
-- is guaranteed to run in a later, separate transaction.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TYPE public.member_role ADD VALUE 'recycler_manager';
ALTER TYPE public.member_role ADD VALUE 'scale_operator';

-- ═══════════════════════════════════════════════════════════════════════════
-- END OF MIGRATION 017
-- ═══════════════════════════════════════════════════════════════════════════
