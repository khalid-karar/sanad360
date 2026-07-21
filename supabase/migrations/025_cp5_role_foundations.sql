-- ═══════════════════════════════════════════════════════════════════════════
-- Sanad 360 – Migration 025: CP5 role foundations (schema + RLS helpers only)
--
-- Everything in this migration references the seven member_role values added
-- in 024 — safe now that they're committed in a prior transaction.
--
-- SCOPE OF THIS MIGRATION (deliberately narrow — see DEFERRED below):
--   A. one_tenant CHECK widened for the new tenant-less Maya-side roles.
--   B. A new CHECK requiring branch_id whenever role = 'branch_operator' —
--      one-directional (not a biconditional): seed.sql already pins an
--      ordinary 'manager' membership to a branch, a legitimate pre-existing
--      use of the column, so this only enforces the direction CP5 actually
--      needs.
--   C. companies.industry — a plain CHECK-constrained text column, not a
--      Postgres ENUM. Unlike member_role (a small, stable, code-referenced
--      set), industry categories are a product/business classification
--      likely to be tuned by non-engineering input — a CHECK list can be
--      widened in a single ALTER, with none of the ADD-VALUE-in-its-own-
--      transaction ceremony a real enum would require for what's expected to
--      be a living list. Placeholder values below pending product sign-off
--      (see plan). Nullable: existing rows have no value and this migration
--      doesn't backfill one (no true value exists to backfill — same
--      reasoning as 022's NOT VALID QR-check decision); the onboarding form
--      makes it required going forward at the app layer.
--   D. Four SECURITY DEFINER helper functions, same shape/pattern as 021's
--      can_review_documents() — is_full_admin(), is_branch_operator_for(),
--      can_manage_billing(), is_gov_viewer(). None of these are wired into
--      any table's RLS policy yet in this migration: every existing table
--      (companies, branches, drivers, vehicles, pickup_events,
--      disposal_confirmations, documents, ...) keeps its current policies
--      completely unchanged. Wiring happens where each new role's actual
--      feature lands, not speculatively here.
--
--   Why no RLS change on `branches` for branch_operator: it already inherits
--   read access to its own company's branches via the existing
--   companies_select_for_own_memberships / branches company-scoped SELECT
--   policies (its membership row's company_id matches, same as owner/
--   manager) — no new policy needed. Branch WRITE (UPDATE) is already
--   restricted to an explicit owner/manager allow-list that branch_operator
--   was never added to, so it's excluded by omission, not by a new DENY.
--   The one real enforcement point — the QR-issue endpoint only handing a
--   branch_operator their OWN branch's token — lives in services/pdf
--   (app code), not in this migration.
--
-- DEFERRED to a later migration + the app-code phase (each needs a design
-- decision from the CP5 plan review before it can be written correctly):
--   - support_agent's audited-RPC functions (support_lookup_company(),
--     support_resend_invite(), support_trigger_password_reset(), ...). Not
--     given any direct RLS SELECT bypass here on purpose — see the plan:
--     Postgres has no SELECT trigger, so "every read is audited" can only be
--     guaranteed by routing all support access through SECURITY DEFINER
--     functions that read-and-log atomically, never a permissive policy.
--   - gov_viewer's aggregate view(s) — pending a decision on what "region"
--     maps to (branches.city? a new region column/enum? a KSA province
--     list?) before the GROUP BY shape can be written.
--   - system_admin's actual permission surface — pending product decision
--     on its boundary vs super_admin/support_agent.
--   - consultant's engagement-scope restrictions in RLS — no policy surface
--     to write yet (no billing tables, no membership-management policy
--     distinct from owner/manager today); noted as a constraint future
--     billing/user-admin policies must respect.
--   - src/lib/database.types.ts MemberRole union, App.tsx/LoginPage routing,
--     TenantSwitcher's stale ROLE_ROUTE map — app code, explicitly held
--     until after this migration is reviewed.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────
-- A. one_tenant — widen for the new tenant-less roles
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.memberships DROP CONSTRAINT one_tenant;
ALTER TABLE public.memberships ADD CONSTRAINT one_tenant CHECK (
  num_nonnulls(company_id, transport_company_id, facility_id) = 1
  OR (
    role IN (
      'admin', 'document_reviewer',
      'super_admin', 'system_admin', 'support_agent', 'billing_accountant',
      'gov_viewer'
    )
    AND company_id IS NULL AND transport_company_id IS NULL AND facility_id IS NULL
  )
);

-- ─────────────────────────────────────────────────────────────
-- B. branch_operator REQUIRES branch_id — one-directional, not a
--    biconditional. branch_id already exists on memberships since 001, and
--    seed.sql already uses it to pin an ordinary 'manager' membership to a
--    single branch (a legitimate existing use predating this migration) —
--    so the constraint only enforces the direction CP5 actually needs
--    (branch_operator cannot exist without a branch) and does not forbid
--    other roles from optionally scoping to one too.
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.memberships ADD CONSTRAINT branch_operator_requires_branch CHECK (
  role <> 'branch_operator' OR branch_id IS NOT NULL
);

-- ─────────────────────────────────────────────────────────────
-- C. companies.industry — placeholder CHECK list, pending product sign-off
--    (see migration header + CP5 plan).
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.companies ADD COLUMN industry text;
ALTER TABLE public.companies ADD CONSTRAINT companies_industry_check CHECK (
  industry IS NULL OR industry IN (
    'food_beverage', 'healthcare', 'manufacturing', 'construction',
    'hospitality', 'retail', 'oil_gas', 'education', 'government', 'other'
  )
);

-- ─────────────────────────────────────────────────────────────
-- D. Helper functions — same STABLE/SECURITY DEFINER/search_path='' shape
--    as 021's can_review_documents(). None referenced by any policy yet.
-- ─────────────────────────────────────────────────────────────

-- 'admin' is left completely untouched (used as a full-bypass OR-clause in
-- dozens of existing policies across 20+ migrations — rewriting all of them
-- to also recognize 'super_admin' is out of scope for this migration and a
-- needless blast radius). New CP5 policies should use is_full_admin() so
-- 'super_admin' gets the same bypass without touching existing 'admin'
-- checks anywhere.
CREATE OR REPLACE FUNCTION public.is_full_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT (public.my_membership()).role IN ('admin', 'super_admin');
$$;

-- True only for a branch_operator whose OWN branch_id matches p_branch_id —
-- the exact check the QR-issue endpoint (services/pdf) needs to add
-- alongside its existing owner/manager check, without granting a
-- branch_operator access to any other branch's token.
CREATE OR REPLACE FUNCTION public.is_branch_operator_for(p_branch_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT (public.my_membership()).role = 'branch_operator'
     AND (public.my_membership()).branch_id = p_branch_id;
$$;

-- Billing tables don't exist yet (greenfield) — this exists so the future
-- billing schema's policies have a single, already-tested predicate to key
-- off from day one, instead of every billing policy re-deriving its own
-- role list.
CREATE OR REPLACE FUNCTION public.can_manage_billing()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT (public.my_membership()).role IN ('billing_accountant', 'admin', 'super_admin');
$$;

CREATE OR REPLACE FUNCTION public.is_gov_viewer()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT (public.my_membership()).role = 'gov_viewer';
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- END OF MIGRATION 025
-- ═══════════════════════════════════════════════════════════════════════════
