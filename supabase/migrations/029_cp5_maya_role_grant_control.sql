-- ═══════════════════════════════════════════════════════════════════════════
-- Sanad 360 – Migration 029: only super_admin may grant/modify a Maya-side
-- role — enforced in the DB, not just the UI
--
-- CP5 item 3's hard rule. The seven Maya-side (tenant-less) role values are:
-- admin, super_admin, system_admin, support_agent, billing_accountant,
-- document_reviewer, gov_viewer — the exact same set 025 widened one_tenant
-- for (025 already confirmed correct: it allows all-null for every one of
-- these seven, not just the five named in the CP5 answer — 'admin' was
-- already there from 021, and gov_viewer was included in 025 on the
-- reasoning that it's cross-tenant by nature; no change needed to that
-- constraint here).
--
-- THIS MIGRATION IS THE FIRST TIME ANY AUTHENTICATED ROLE GETS A WRITE PATH
-- TO public.memberships AT ALL. Every membership row today (confirmed by
-- research: zero INSERT/UPDATE/DELETE policies exist, only a table-level
-- SELECT grant) is created exclusively via service_role — onboarding
-- endpoints, invite flows, seed data. This migration adds a narrow,
-- content-restricted authenticated path (super_admin granting/modifying a
-- Maya-side role ONLY) so that path is real enough to test against with a
-- real signed-in user, per the CP5 guardrail (RLS tests as real
-- authenticated users) — not so a test can merely observe "authenticated
-- writes are blocked," which would prove nothing about the specific rule.
--
-- TWO ENFORCEMENT LAYERS, deliberately redundant:
--   1. RLS INSERT/UPDATE policies, scoped EXCLUSIVELY to rows where
--      NEW.role is Maya-side — for any other role value they contribute
--      nothing (evaluate false), leaving tenant-side membership writes
--      exactly as service_role-only as they are today. This is the layer
--      that makes the requested test meaningful.
--   2. A BEFORE INSERT/UPDATE trigger, which fires for EVERY writer
--      including service_role (RLS bypass does NOT bypass triggers) — a
--      second, independent layer that would still catch a future INSERT
--      policy that forgets to exclude Maya-side roles.
--
-- HONEST LIMIT (stating this plainly rather than overclaiming DB coverage):
-- service_role is Postgres's actual trust boundary — a connection made with
-- the service key has no auth.uid() at all, so neither layer above can
-- verify "who" is behind a service-role-mediated write. Any backend
-- endpoint (services/pdf or future admin console) that grants a Maya-side
-- role via the service-role client MUST itself authenticate the caller and
-- verify they hold 'super_admin' BEFORE ever issuing that call — the DB
-- cannot see across that boundary, and no migration can make it able to.
-- What this migration DOES guarantee: any Maya-side role grant or
-- modification attempted through an authenticated user's own session
-- (their own JWT, RLS in effect) is rejected unless that user is already
-- super_admin — closing the specific self-escalation path CP5 asked about
-- (a system_admin using their own credentials to grant themselves or
-- another user a Maya-side role).
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.enforce_maya_role_grant()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.role IN (
    'admin', 'super_admin', 'system_admin', 'support_agent',
    'billing_accountant', 'document_reviewer', 'gov_viewer'
  ) THEN
    IF auth.uid() IS NOT NULL AND (public.my_membership()).role <> 'super_admin' THEN
      RAISE EXCEPTION 'MAYA_ROLE_GRANT_FORBIDDEN: only super_admin may grant or modify a Maya-side role (attempted: %)', NEW.role
        USING ERRCODE = 'P0030';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER memberships_enforce_maya_role_grant
  BEFORE INSERT OR UPDATE ON public.memberships
  FOR EACH ROW EXECUTE FUNCTION public.enforce_maya_role_grant();

-- Narrow authenticated write path — see header. Table-level GRANT is
-- required alongside the RLS policies (Postgres checks table-level
-- privilege first); this is safe specifically because the policies below
-- are the ONLY ones for authenticated INSERT/UPDATE on this table, so their
-- content-restriction is the entire authenticated write surface, not an
-- addition to some broader existing grant.
GRANT INSERT, UPDATE ON public.memberships TO authenticated;

CREATE POLICY memberships_insert_maya_role ON public.memberships
  FOR INSERT TO authenticated
  WITH CHECK (
    role IN (
      'admin', 'super_admin', 'system_admin', 'support_agent',
      'billing_accountant', 'document_reviewer', 'gov_viewer'
    )
    AND (public.my_membership()).role = 'super_admin'
  );

CREATE POLICY memberships_update_maya_role ON public.memberships
  FOR UPDATE TO authenticated
  USING (
    role IN (
      'admin', 'super_admin', 'system_admin', 'support_agent',
      'billing_accountant', 'document_reviewer', 'gov_viewer'
    )
    AND (public.my_membership()).role = 'super_admin'
  )
  WITH CHECK (
    role IN (
      'admin', 'super_admin', 'system_admin', 'support_agent',
      'billing_accountant', 'document_reviewer', 'gov_viewer'
    )
    AND (public.my_membership()).role = 'super_admin'
  );

-- ─────────────────────────────────────────────────────────────
-- H. memberships_select had NO admin/super_admin bypass before this
--    migration — uniquely among every table in this schema, it was
--    self-row-only (`user_id = auth.uid()`), because nothing before CP5
--    ever needed to look at someone ELSE's membership row. That silently
--    breaks the grant above: Postgres re-checks a table's SELECT policy
--    against the resulting row for any INSERT/UPDATE ... RETURNING (which
--    every supabase-js call issues by default) — so without a SELECT
--    bypass, a super_admin's otherwise-permitted grant to another user
--    still throws "new row violates row-level security policy", because
--    the just-inserted row isn't visible to them afterward.
--
--    NARROWED per review: scoped to Maya-side ROWS ONLY (`role IN (...)`),
--    not a blanket "super_admin sees every membership" bypass. super_admin
--    has no established need in CP5 to browse arbitrary tenant-side
--    (owner/manager/driver/...) membership rows across every company — the
--    concrete, provable need is exactly "see the Maya-side roster (for
--    governance) and see the row they just granted/modified (for
--    RETURNING)." This is an ADDITIVE permissive policy (OR'd with the
--    existing self-only one) and does not touch anyone's self-row
--    visibility; it also does NOT reach into any tenant's company/
--    transport_company/facility membership data — see the accompanying
--    test (cp5-maya-role-grant-control.test.ts) proving a tenant-side
--    owner/manager gets no expanded visibility at all, and this policy
--    grants none into tenant data regardless of who queries it.
-- ─────────────────────────────────────────────────────────────
CREATE POLICY memberships_select_maya_role ON public.memberships
  FOR SELECT TO authenticated
  USING (
    role IN (
      'admin', 'super_admin', 'system_admin', 'support_agent',
      'billing_accountant', 'document_reviewer', 'gov_viewer'
    )
    AND (public.my_membership()).role = 'super_admin'
  );

-- ─────────────────────────────────────────────────────────────
-- I. Per-read auditing of this bypass is NOT possible: Postgres has no
--    SELECT trigger, so "every read is logged" cannot be guaranteed for ANY
--    RLS-based visibility — this is the exact same limitation already
--    established for support_agent (025/026 plan: audited access there is
--    RPC-mediated for that reason, never a raw bypass). The honest
--    substitute, and arguably the more important event to capture anyway:
--    audit every WRITE (grant or modification) of a Maya-side role — who
--    granted what, to whom, when. tenant_type='admin' is audit_log's own
--    documented-but-never-used third value (001's column comment listed
--    it from day one; this is its first real use).
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.memberships_after_maya_role_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.role IN (
    'admin', 'super_admin', 'system_admin', 'support_agent',
    'billing_accountant', 'document_reviewer', 'gov_viewer'
  ) THEN
    INSERT INTO public.audit_log (user_id, tenant_id, tenant_type, action, entity_type, entity_id, changes)
    VALUES (
      auth.uid(), NULL, 'admin',
      CASE WHEN TG_OP = 'INSERT' THEN 'grant_maya_role' ELSE 'modify_maya_role' END,
      'memberships', NEW.id,
      jsonb_build_object('granted_role', NEW.role, 'target_user_id', NEW.user_id)
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER memberships_after_maya_role_write
  AFTER INSERT OR UPDATE ON public.memberships
  FOR EACH ROW EXECUTE FUNCTION public.memberships_after_maya_role_write();

-- ═══════════════════════════════════════════════════════════════════════════
-- END OF MIGRATION 029
-- ═══════════════════════════════════════════════════════════════════════════
