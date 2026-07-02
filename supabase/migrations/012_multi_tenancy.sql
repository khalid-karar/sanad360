-- ═══════════════════════════════════════════════════════════════════════════
-- Sanad 360 – Migration 012: Consultant multi-tenancy (active-tenant selection)
-- ═══════════════════════════════════════════════════════════════════════════
-- memberships was designed for one-user-many-tenants from day one (001
-- deliberately has no UNIQUE on user_id), but my_membership() used
-- `LIMIT 1` with NO ORDER BY: with two memberships the caller's effective
-- tenant was NONDETERMINISTIC — a security-relevant coin flip that every RLS
-- policy in the schema depends on.
--
-- Fix, without touching a single policy:
--   • user_active_tenant — one row per user pointing at the membership they
--     are currently "acting as" (self-managed, RLS self-only, and the
--     membership must be their own).
--   • my_membership() — prefers the selected membership, falls back to the
--     OLDEST membership (created_at, id tiebreak). Fully deterministic.
--
-- Every policy keeps calling my_membership(); the consultant channel (one
-- user → many companies) becomes a UI concern: switch tenant = update one row.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE public.user_active_tenant (
  user_id       uuid        PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  membership_id uuid        NOT NULL REFERENCES public.memberships(id) ON DELETE CASCADE,
  updated_at    timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_active_tenant TO authenticated;
GRANT ALL ON public.user_active_tenant TO service_role;

ALTER TABLE public.user_active_tenant ENABLE ROW LEVEL SECURITY;

-- Self-only, and the chosen membership must belong to the caller. The
-- memberships subquery runs as the caller, whose RLS already restricts
-- visibility to their own rows — belt and suspenders.
CREATE POLICY user_active_tenant_select ON public.user_active_tenant
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY user_active_tenant_insert ON public.user_active_tenant
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.memberships m
      WHERE m.id = membership_id AND m.user_id = auth.uid()
    )
  );

CREATE POLICY user_active_tenant_update ON public.user_active_tenant
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.memberships m
      WHERE m.id = membership_id AND m.user_id = auth.uid()
    )
  );

CREATE POLICY user_active_tenant_delete ON public.user_active_tenant
  FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- ─────────────────────────────────────────────────────────────
-- Deterministic, selection-aware my_membership()
-- Same signature and SECURITY DEFINER contract as 001 — every existing
-- policy picks this up automatically.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.my_membership()
RETURNS public.memberships
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT m.*
  FROM public.memberships m
  LEFT JOIN public.user_active_tenant t
    ON t.user_id = m.user_id AND t.membership_id = m.id
  WHERE m.user_id = auth.uid()
  ORDER BY (t.membership_id IS NOT NULL) DESC, m.created_at ASC, m.id ASC
  LIMIT 1;
$$;

-- ─────────────────────────────────────────────────────────────
-- Tenant NAMES for the switcher UI
-- companies/transport_companies SELECT was scoped to the ACTIVE membership
-- only, so a consultant could never render the names of their other tenants.
-- Additive: a user may read the identity row of ANY tenant they hold a
-- membership in (the memberships subquery runs as the caller, whose RLS
-- already limits it to their own rows).
-- ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS companies_select_for_own_memberships ON public.companies;
CREATE POLICY companies_select_for_own_memberships ON public.companies
  FOR SELECT TO authenticated
  USING (
    id IN (SELECT m.company_id FROM public.memberships m WHERE m.user_id = auth.uid())
  );

DROP POLICY IF EXISTS transport_companies_select_for_own_memberships ON public.transport_companies;
CREATE POLICY transport_companies_select_for_own_memberships ON public.transport_companies
  FOR SELECT TO authenticated
  USING (
    id IN (SELECT m.transport_company_id FROM public.memberships m WHERE m.user_id = auth.uid())
  );

-- ═══════════════════════════════════════════════════════════════════════════
-- END OF MIGRATION 012
-- ═══════════════════════════════════════════════════════════════════════════
