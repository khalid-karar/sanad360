-- ═══════════════════════════════════════════════════════════════════════════
-- Sanad 360 – Migration 020: document_reviewer role (enum value only)
-- ═══════════════════════════════════════════════════════════════════════════
-- Same rule as 017: a newly added enum value cannot be referenced by any
-- DDL/DML in the SAME migration transaction that adds it. This migration
-- does nothing but add the value, so 021 (which references it in the
-- one_tenant CHECK and in RLS policies) is guaranteed to run in a later,
-- separate transaction.
--
-- document_reviewer is the first of CP1 018's flagged "CP5 forward-compat"
-- Maya-side roles to actually land. It is tenant-less (no company_id /
-- transport_company_id / facility_id), same shape as 'admin'.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TYPE public.member_role ADD VALUE 'document_reviewer';

-- ═══════════════════════════════════════════════════════════════════════════
-- END OF MIGRATION 020
-- ═══════════════════════════════════════════════════════════════════════════
