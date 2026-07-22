-- ═══════════════════════════════════════════════════════════════════════════
-- Sanad 360 – Migration 041: CP5.5 — pending_documents stage
-- ═══════════════════════════════════════════════════════════════════════════
-- Decision change from 035/036: documents are no longer collected at signup
-- time. New state machine:
--
--   pending_email_verification --(verify_application_email)--> pending_documents
--     --(applicant uploads required docs, then submit_application_for_review)-->
--   pending_review --(review_pending_application, unchanged)--> approved | rejected
--
-- Nothing about approval/rejection changes here — review_pending_application()
-- (035) is untouched. Document upload during pending_documents reuses the
-- EXISTING authenticated document-upload path (owns_document_target already
-- allows role='applicant' to write under owner_type='pending_application',
-- owner_id=<their own application id> — that grant predates this migration
-- and needs no change). What's new is (1) the status value itself, (2) moving
-- verify_application_email()'s success target from pending_review to
-- pending_documents, (3) the gate function that lets an applicant move
-- themselves from pending_documents to pending_review only once their
-- documents are actually complete, scoped correctly by tenant_type (NOT the
-- 037 'pending_application' union — see part C for why that union is the
-- wrong list to check against), and (4) a sweep for applications that stall
-- in pending_documents indefinitely, mirroring 036's rationale for the
-- pending_email_verification sweep (frees the CR slot; no human "rejected"
-- a walk-away).
-- ═══════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────
-- A. Add 'pending_documents' to the status CHECK.
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.pending_applications DROP CONSTRAINT pending_applications_status_check;
ALTER TABLE public.pending_applications ADD CONSTRAINT pending_applications_status_check
  CHECK (status IN (
    'pending_email_verification',
    'pending_documents',
    'pending_review',
    'approved',
    'rejected'
  ));

-- ─────────────────────────────────────────────────────────────
-- B. pending_applications_reviewed_fields_consistency — 'pending_documents'
--    must join the "no reviewed_by/reviewed_at yet" bucket alongside the
--    other two pre-decision statuses, or every row that reaches this status
--    violates the CHECK outright (it currently enumerates exactly two
--    statuses on that side and rejects anything else).
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.pending_applications DROP CONSTRAINT pending_applications_reviewed_fields_consistency;
ALTER TABLE public.pending_applications ADD CONSTRAINT pending_applications_reviewed_fields_consistency CHECK (
  (status IN ('approved', 'rejected') AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)
  OR
  (status IN ('pending_email_verification', 'pending_documents', 'pending_review') AND reviewed_by IS NULL AND reviewed_at IS NULL)
);

-- No change needed to pending_applications_reject_reason_required (only
-- fires on status='rejected') or pending_applications_resulting_tenant_
-- consistency (its non-approved branch already uses `status <> 'approved'`,
-- which covers 'pending_documents' without modification) or pending_
-- applications_email_verification_consistency (only constrains status=
-- 'pending_email_verification'; 'pending_documents' rows are free to have
-- email_verified_at set, which is exactly what verify_application_email()
-- below does before handing off to this status).

-- ─────────────────────────────────────────────────────────────
-- C. verify_application_email() — DIFF vs 035/036: only the UPDATE's status
--    target changes, from 'pending_review' to 'pending_documents'. Every
--    other line (token hashing, generic failure shape, clearing the token
--    hash/expiry, the RETURN QUERY shapes, SECURITY DEFINER/search_path,
--    the service_role-only GRANT from 036) is unchanged.
-- ─────────────────────────────────────────────────────────────
--
-- --- diff ---
--    UPDATE public.pending_applications
--    SET status = 'pending_review',
-- +  SET status = 'pending_documents',
--        email_verified_at = now(),
--        email_verification_token_hash = NULL,
--        email_verification_expires_at = NULL
--    WHERE id = v_app.id;
-- --- end diff ---
--
CREATE OR REPLACE FUNCTION public.verify_application_email(p_token text)
RETURNS TABLE (success boolean, application_id uuid, applicant_user_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_hash text;
  v_app public.pending_applications;
BEGIN
  IF p_token IS NULL OR btrim(p_token) = '' THEN
    RETURN QUERY SELECT false, NULL::uuid, NULL::uuid;
    RETURN;
  END IF;

  v_hash := encode(extensions.digest(convert_to(p_token, 'UTF8'), 'sha256'), 'hex');

  SELECT * INTO v_app
  FROM public.pending_applications
  WHERE email_verification_token_hash = v_hash
    AND status = 'pending_email_verification'
    AND email_verification_expires_at > now();

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, NULL::uuid, NULL::uuid;
    RETURN;
  END IF;

  UPDATE public.pending_applications
  SET status = 'pending_documents',
      email_verified_at = now(),
      email_verification_token_hash = NULL,
      email_verification_expires_at = NULL
  WHERE id = v_app.id;

  RETURN QUERY SELECT true, v_app.id, v_app.applicant_user_id;
END;
$$;

-- GRANT unchanged from 036 (service_role only) — restated only because
-- CREATE OR REPLACE does not touch privileges, so nothing to do here; no
-- GRANT/REVOKE statements in this section.

-- ─────────────────────────────────────────────────────────────
-- D. submit_application_for_review(id) — the ONLY path pending_documents ->
--    pending_review. Authenticated applicant, own row only. Completeness is
--    checked against required_documents for the application's REAL
--    tenant_type ('company' or 'transport_company'), never against
--    owner_type='pending_application' — that union (037) exists purely as
--    an upload allowlist (so the trigger doesn't reject a doc_type that a
--    real UI would offer), not a completion denominator. 037's own header
--    comment flagged this exact split as the thing to do "if a future
--    completion bar for pending applications ever calls
--    owner_document_status('pending_application', ...)" — this is that
--    point, done as a direct query here rather than reusing
--    _owner_document_status_unsafe (which is keyed by a single owner_type,
--    not "documents stored under one owner_type, required list under
--    another").
--
--    "Uploaded" = latest document row per doc_type (mirrors
--    _owner_document_status_unsafe's LATERAL/created_at DESC pattern) whose
--    status is NOT 'rejected' — a still-pending upload counts (review of
--    the actual documents happens later, during pending_review), a
--    rejected one does not (the applicant must re-upload).
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.submit_application_for_review(p_application_id uuid)
RETURNS TABLE (status text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_app             public.pending_applications;
  v_missing_types   text[];
BEGIN
  SELECT * INTO v_app FROM public.pending_applications WHERE id = p_application_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'application not found';
  END IF;

  IF (public.my_membership()).role <> 'applicant' OR v_app.applicant_user_id <> auth.uid() THEN
    RAISE EXCEPTION 'FORBIDDEN: only the applicant who owns this application may submit it'
      USING ERRCODE = '42501';
  END IF;

  IF v_app.status <> 'pending_documents' THEN
    RAISE EXCEPTION 'application is not awaiting document submission (current status: %)', v_app.status;
  END IF;

  SELECT array_agg(rd.doc_type ORDER BY rd.doc_type) INTO v_missing_types
  FROM public.required_documents rd
  LEFT JOIN LATERAL (
    SELECT d.status
    FROM public.documents d
    WHERE d.owner_type = 'pending_application'
      AND d.owner_id = p_application_id
      AND d.doc_type = rd.doc_type
    ORDER BY d.created_at DESC
    LIMIT 1
  ) latest ON true
  WHERE rd.owner_type = v_app.tenant_type
    AND (latest.status IS NULL OR latest.status = 'rejected');

  IF v_missing_types IS NOT NULL AND array_length(v_missing_types, 1) > 0 THEN
    RAISE EXCEPTION 'INCOMPLETE_DOCUMENTS: missing required documents: %', array_to_string(v_missing_types, ', ')
      USING ERRCODE = 'P0030';
  END IF;

  UPDATE public.pending_applications
  SET status = 'pending_review'
  WHERE id = p_application_id;

  RETURN QUERY SELECT 'pending_review'::text;
END;
$$;

GRANT EXECUTE ON FUNCTION public.submit_application_for_review(uuid) TO authenticated;

-- ─────────────────────────────────────────────────────────────
-- E. sweep_stale_pending_documents_applications() — sibling to 036's
--    sweep_stale_unverified_applications(), not a rewrite of it (that
--    function's job — cleaning up never-verified signups — is unchanged by
--    this migration). Same CR-squatting rationale as 036: an applicant who
--    verifies their email but never uploads/submits would otherwise hold
--    the CR forever. Window is 7 days from email_verified_at (the moment
--    this status was entered). Same cleanup shape as 036: soft-revoke the
--    'applicant' membership, delete any pending_application-owned
--    documents, delete the row (frees the CR). service_role only.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.sweep_stale_pending_documents_applications()
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
    WHERE status = 'pending_documents'
      AND email_verified_at IS NOT NULL
      AND email_verified_at < now() - interval '7 days'
  LOOP
    UPDATE public.memberships
    SET revoked_at = now(), revoked_by = NULL,
        revoke_reason = 'Automated: application left incomplete in pending_documents past the 7-day window'
    WHERE user_id = v_applicant_user_id AND role = 'applicant' AND revoked_at IS NULL;

    DELETE FROM public.documents
    WHERE owner_type = 'pending_application' AND owner_id = v_app_id;

    DELETE FROM public.pending_applications WHERE id = v_app_id;

    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.sweep_stale_pending_documents_applications() FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.sweep_stale_pending_documents_applications() TO service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- END OF MIGRATION 041
-- ═══════════════════════════════════════════════════════════════════════════
