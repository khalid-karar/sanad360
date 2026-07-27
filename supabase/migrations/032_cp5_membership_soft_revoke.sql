-- ═══════════════════════════════════════════════════════════════════════════
-- Sanad 360 – Migration 032: membership soft-revoke (CP5 app-code phase 4g)
-- ═══════════════════════════════════════════════════════════════════════════
-- Revoking a member's access must not delete their membership row — the row
-- is the only record that this person ever held this role at this tenant,
-- which matters for the audit trail (who confirmed which pickups, who
-- reviewed which document, etc. all reference profiles/memberships that must
-- keep resolving). Soft revoke (revoked_at/revoked_by/revoke_reason,
-- exactly the shape already used elsewhere in this schema — e.g.
-- documents.rejected_at/rejected_by) instead of DELETE.
--
-- The actual mutation happens through a NEW service_role-only backend
-- endpoint (services/pdf POST /company/revoke-membership), not a client-
-- permitted RLS UPDATE path — mirrors invite-driver.ts's existing pattern
-- (owner/manager-of-that-company auth-checked in the endpoint, admin/
-- service-role client does the write). This migration therefore does NOT
-- grant authenticated UPDATE on the new columns; only my_membership() needs
-- to change so a revoked row stops being anyone's "active membership"
-- everywhere in the schema at once (every RLS policy in this codebase reads
-- through that one function).
-- ═══════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────
-- A. New columns
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.memberships
  ADD COLUMN revoked_at    timestamptz,
  ADD COLUMN revoked_by    uuid REFERENCES public.profiles(id),
  ADD COLUMN revoke_reason text;

ALTER TABLE public.memberships ADD CONSTRAINT memberships_revoke_reason_required CHECK (
  revoked_at IS NULL OR (revoke_reason IS NOT NULL AND length(trim(revoke_reason)) > 0)
);

CREATE INDEX memberships_revoked_at_idx ON public.memberships(revoked_at) WHERE revoked_at IS NOT NULL;

-- ─────────────────────────────────────────────────────────────
-- B. my_membership() — exclude revoked rows. This is the ENTIRE
--    enforcement mechanism: every RLS policy in the schema resolves the
--    caller's role/tenant through this one function, so a revoked row
--    simply stops existing for every one of them simultaneously. If a
--    revoked row was the caller's ONLY membership, my_membership() now
--    returns no row at all — every policy that reads (public.my_membership()).role
--    then compares against NULL, which is never TRUE/never IN any role list,
--    so the caller is locked out everywhere, fail-closed.
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
    AND m.revoked_at IS NULL
  ORDER BY (t.membership_id IS NOT NULL) DESC, m.created_at ASC, m.id ASC
  LIMIT 1;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- END OF MIGRATION 032
-- ═══════════════════════════════════════════════════════════════════════════
