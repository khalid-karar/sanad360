-- ═══════════════════════════════════════════════════════════════════════════
-- Sanad 360 – Migration 024: CP5 member_role enum values (values only)
-- ═══════════════════════════════════════════════════════════════════════════
-- Same rule as 017/020: a newly added enum value cannot be referenced by any
-- DDL/DML in the SAME migration transaction that adds it. This migration does
-- nothing but add values, so 025 (which references every one of them in the
-- one_tenant CHECK, the branch-scoping CHECK, and new helper functions) is
-- guaranteed to run in a later, separate transaction.
--
-- Seven new values, two shapes:
--
--   Tenant-less (Maya/System side, same shape as 'admin'/'document_reviewer',
--   widened into one_tenant in 025):
--     super_admin         — full-bypass, additive alongside legacy 'admin'
--                           (see 025 header for why 'admin' itself is
--                           untouched rather than replaced).
--     system_admin        — platform/user administration; scope finalized in
--                           app-code phase pending product decision on the
--                           exact boundary vs super_admin/support_agent.
--     support_agent        — cross-tenant read-mostly + safe ops, but with NO
--                           direct RLS bypass on customer-data tables (see
--                           025 header — every read must be individually
--                           audit-logged, which an RLS bypass cannot
--                           guarantee; access is mediated entirely through
--                           SECURITY DEFINER RPCs added in a later migration).
--     billing_accountant   — billing/invoices/subscriptions only, explicitly
--                           NO ledger/evidence access. Billing tables don't
--                           exist yet (greenfield) — this value just reserves
--                           the role shape ahead of that build.
--     gov_viewer           — read-only aggregated compliance/regional stats.
--                           Tenant-less because it spans all tenants; sees
--                           ONLY pre-aggregated views, never a raw row with
--                           driver PII (PDPL).
--
--   Tenant-scoped (existing shape, no one_tenant change needed):
--     branch_operator      — company-side, scoped to exactly one branch
--                           (enforced by a new CHECK in 025 requiring
--                           branch_id IS NOT NULL for this role, and NULL for
--                           every other role). Operationally required: the
--                           rotating branch QR (migration 022/023) currently
--                           needs an owner/manager physically at the waste
--                           point just to display it.
--     consultant           — same tenant shape as owner/manager (one
--                           membership row per engaged company, switched via
--                           the existing tenant switcher / user_active_tenant,
--                           migration 012 — no schema change needed there).
--                           Distinct from 'manager' so future billing/
--                           user-admin policies can exclude it by role value
--                           alone, without needing a separate per-membership
--                           scope flag.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TYPE public.member_role ADD VALUE 'super_admin';
ALTER TYPE public.member_role ADD VALUE 'system_admin';
ALTER TYPE public.member_role ADD VALUE 'support_agent';
ALTER TYPE public.member_role ADD VALUE 'billing_accountant';
ALTER TYPE public.member_role ADD VALUE 'branch_operator';
ALTER TYPE public.member_role ADD VALUE 'consultant';
ALTER TYPE public.member_role ADD VALUE 'gov_viewer';

-- ═══════════════════════════════════════════════════════════════════════════
-- END OF MIGRATION 024
-- ═══════════════════════════════════════════════════════════════════════════
