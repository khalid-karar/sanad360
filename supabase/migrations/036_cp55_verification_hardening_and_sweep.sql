-- ═══════════════════════════════════════════════════════════════════════════
-- Sanad 360 – Migration 036: CP5.5 hardening — verify-email lockdown + sweep
-- ═══════════════════════════════════════════════════════════════════════════
-- Two follow-ups from reviewing 035 before the endpoint gets built:
--
-- A. REVOKE anon/authenticated EXECUTE on verify_application_email(). 035
--    granted it directly to anon so an unauthenticated caller could hit it
--    from the browser — but the endpoint (next phase) will do that
--    verification server-side via the service-role client instead (so it
--    can ALSO orchestrate admin.auth.admin.updateUserById(id,
--    {email_confirm:true}) in the same request, which no SQL function can
--    do — that's a GoTrue admin-API call, not reachable from Postgres).
--    Leaving a working anon-callable RPC alongside a service-role-only
--    endpoint would be two live paths to the same sensitive transition for
--    no reason — one is enough, and service_role-only is the tighter one.
--
-- B. sweep_stale_unverified_applications() — closes a real hole in 035: the
--    partial unique index (pending_applications_cr_active_uq) only excludes
--    status='rejected', so an application stuck in
--    'pending_email_verification' forever (attacker signs up with a real
--    company's CR, never clicks the email) permanently squats that CR —
--    nobody, including the real company, could ever submit a legitimate
--    application for it. Same posture as sweep_expired_pickup_confirmations
--    (030): a plain SECURITY DEFINER function, no pg_cron wiring here (this
--    environment doesn't assume pg_cron availability — tracked as a
--    follow-up the same way branch_qr_used_tokens cleanup already is),
--    callable by pg_cron OR an external cron hitting a service-role RPC.
--    DELETEs the stale row (not a status flip to 'rejected') because there
--    is no human reviewer for an automated expiry, and
--    pending_applications_reviewed_fields_consistency (035) correctly
--    requires reviewed_by/reviewed_at whenever status IN
--    ('approved','rejected') — modeling that 'rejected' always means an
--    actual human decision, not "the applicant went away". Also cleans up
--    any documents rows uploaded under owner_type='pending_application' for
--    that application (defensive — in practice unlikely to exist yet, since
--    email_confirm stays false and the applicant can't establish a session
--    to upload anything until AFTER verification) and soft-revokes the
--    linked 'applicant' membership (revoked_by NULL is valid — only
--    revoke_reason is required per 032's own CHECK — this is the
--    established shape for a system-initiated, non-human revoke).
-- ═══════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────
-- A. Lock down verify_application_email to service_role only.
-- ─────────────────────────────────────────────────────────────
REVOKE EXECUTE ON FUNCTION public.verify_application_email(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_application_email(text) TO service_role;

-- ─────────────────────────────────────────────────────────────
-- B. sweep_stale_unverified_applications — the daily job.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.sweep_stale_unverified_applications()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_app_id             uuid;
  v_applicant_user_id  uuid;
  v_count              integer := 0;
BEGIN
  FOR v_app_id, v_applicant_user_id IN
    SELECT id, applicant_user_id
    FROM public.pending_applications
    WHERE status = 'pending_email_verification'
      AND email_verification_expires_at IS NOT NULL
      AND email_verification_expires_at < now()
  LOOP
    UPDATE public.memberships
    SET revoked_at = now(), revoked_by = NULL,
        revoke_reason = 'Automated: email verification link expired without confirmation'
    WHERE user_id = v_applicant_user_id AND role = 'applicant' AND revoked_at IS NULL;

    DELETE FROM public.documents
    WHERE owner_type = 'pending_application' AND owner_id = v_app_id;

    -- Frees the commercial_registration slot immediately — this is the
    -- actual fix for the CR-squatting hole described above.
    DELETE FROM public.pending_applications WHERE id = v_app_id;

    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.sweep_stale_unverified_applications() FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.sweep_stale_unverified_applications() TO service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- END OF MIGRATION 036
-- ═══════════════════════════════════════════════════════════════════════════
