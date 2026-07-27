-- ═══════════════════════════════════════════════════════════════════════════
-- Sanad 360 – Migration 043: industries readable by anon (CP8 Slice F finding)
--
-- Migration 028's industries_select policy granted SELECT to `authenticated`
-- only. 028 predates CP5.5's public /signup page (SignupPage.tsx), which
-- calls listIndustries() to populate the required Industry dropdown for a
-- 'company' applicant BEFORE that applicant has any session at all — the
-- call runs as `anon`, not `authenticated`. Nobody cross-checked 028's grant
-- against CP5.5's later pre-auth surface.
--
-- Real-world impact (found by CP8 Slice F's browser E2E test driving the
-- actual /signup form, not a Vitest test hitting the API as an authenticated
-- role): every real company applicant has always hit a 42501 permission
-- error on this SELECT, silently swallowed by SignupPage.tsx's own comment
-- ("Non-fatal — the field just shows no options"), leaving the Industry
-- field permanently empty. Since it's `required` for tenant_type='company',
-- this made company self-service signup impossible to complete in
-- production since the day it shipped.
--
-- Fix: widen the policy/grant to include `anon`, same USING clause as
-- before (is_active rows, or all rows for an admin — my_membership() returns
-- NULL for an anonymous caller, so that OR branch degrades to NULL, not an
-- error, and the row is included only via is_active — verified against
-- migration 032's my_membership() body, a LANGUAGE sql function with no
-- explicit EXECUTE restriction, so PUBLIC's default EXECUTE grant already
-- covers anon).
-- ═══════════════════════════════════════════════════════════════════════════

DROP POLICY industries_select ON public.industries;

CREATE POLICY industries_select ON public.industries
  FOR SELECT TO anon, authenticated
  USING (is_active OR (public.my_membership()).role = 'admin');

GRANT SELECT ON public.industries TO anon;

-- ═══════════════════════════════════════════════════════════════════════════
-- END OF MIGRATION 043
-- ═══════════════════════════════════════════════════════════════════════════
