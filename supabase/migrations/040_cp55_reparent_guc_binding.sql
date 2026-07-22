-- ═══════════════════════════════════════════════════════════════════════════
-- Sanad 360 – Migration 040: bind the 038 re-parent exception to the one
-- authorized call site (closes a real reviewer-bypass gap)
-- ═══════════════════════════════════════════════════════════════════════════
-- 038's re-parent exception in documents_before_update() was gated on
-- can_review_documents() — but that's a ROLE check, not a "this call came
-- from review_pending_application()" check. Any real document_reviewer/
-- admin session could run the narrow-field-match UPDATE directly (a plain
-- client .update()), completely bypassing review_pending_application()'s
-- other invariants: no approver != applicant check, no requirement that the
-- application even be in 'pending_review', no real tenant gets created, no
-- audit_log row written. A reviewer could silently re-parent a pending
-- application's document onto ANY existing company/transport_company with
-- zero audit trail. Confirmed exploitable, not theoretical.
--
-- FIX: bind the exception to the SPECIFIC transaction
-- review_pending_application() is running in, via a transaction-local GUC
-- (set_config(..., true) — the `true` makes it invisible outside this
-- transaction, unlike a session-level `SET`) set immediately before the
-- reparenting UPDATE, naming the exact application being reparented.
-- documents_before_update()'s exception branch now checks that GUC equals
-- OLD.owner_id (the pending_applications.id being moved off), INSTEAD OF
-- can_review_documents() — not additionally, replacing it entirely, since
-- the role check is what was bypassable and must not survive as an OR.
-- current_setting(..., missing_ok=true) returns NULL when unset (i.e. any
-- call NOT originating inside review_pending_application()'s transaction),
-- and NULL IS DISTINCT FROM <owner_id text> is TRUE, so an unbound caller is
-- rejected the same way an unauthenticated one would be.
--
-- Field-shape narrowness (unchanged from 038, restated because it's what
-- makes this safe even to a caller who DID somehow get the GUC set):
-- the exception's IF condition requires status/reviewed_by/reviewed_at/
-- reject_reason to be IS NOT DISTINCT FROM their OLD values — i.e.
-- identical, not merely allowed to differ. If any of those change alongside
-- owner_type/owner_id, the whole condition is false, the branch does not
-- fire, and the row falls through into the ordinary reviewer-decision path
-- below (which then separately rejects an owner_type/owner_id change via
-- REVIEW_FIELDS_ONLY, since that path never allows them to differ either).
-- There is no way through this branch to also relabel a document's review
-- state — it can ONLY move owner_type/owner_id, nothing else.
--
-- review_pending_application()'s role gate (document_reviewer/system_admin/
-- admin/super_admin, checked at function entry, before ever reaching the
-- reparenting step) is UNCHANGED and is still the actual authorization —
-- this migration moves where the trigger anchors its trust (a specific
-- authorized transaction instead of a role name), it does not remove the
-- role check from the system, since only that role-gated function can ever
-- set the GUC in the first place.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────
-- A. documents_before_update() — swap the exception's gate.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.documents_before_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF OLD.owner_type = 'pending_application'
     AND NEW.owner_type IN ('company', 'transport_company')
     AND NEW.doc_type      IS NOT DISTINCT FROM OLD.doc_type
     AND NEW.file_path     IS NOT DISTINCT FROM OLD.file_path
     AND NEW.file_sha256   IS NOT DISTINCT FROM OLD.file_sha256
     AND NEW.issue_date    IS NOT DISTINCT FROM OLD.issue_date
     AND NEW.expiry_date   IS NOT DISTINCT FROM OLD.expiry_date
     AND NEW.status        IS NOT DISTINCT FROM OLD.status
     AND NEW.reviewed_by   IS NOT DISTINCT FROM OLD.reviewed_by
     AND NEW.reviewed_at   IS NOT DISTINCT FROM OLD.reviewed_at
     AND NEW.reject_reason IS NOT DISTINCT FROM OLD.reject_reason
     AND NEW.uploaded_by   IS NOT DISTINCT FROM OLD.uploaded_by
     AND NEW.created_at    IS NOT DISTINCT FROM OLD.created_at
  THEN
    IF current_setting('sanad.reparenting_application_id', true) IS DISTINCT FROM OLD.owner_id::text THEN
      RAISE EXCEPTION 'REVIEW_ONLY: document re-parenting must go through review_pending_application()'
        USING ERRCODE = 'P0018';
    END IF;
    RETURN NEW;
  END IF;

  IF NOT public.can_review_documents() THEN
    RAISE EXCEPTION 'REVIEW_ONLY: only a document_reviewer or admin may update a document'
      USING ERRCODE = 'P0018';
  END IF;

  IF NEW.owner_type   IS DISTINCT FROM OLD.owner_type
     OR NEW.owner_id     IS DISTINCT FROM OLD.owner_id
     OR NEW.doc_type     IS DISTINCT FROM OLD.doc_type
     OR NEW.file_path    IS DISTINCT FROM OLD.file_path
     OR NEW.file_sha256  IS DISTINCT FROM OLD.file_sha256
     OR NEW.issue_date   IS DISTINCT FROM OLD.issue_date
     OR NEW.expiry_date  IS DISTINCT FROM OLD.expiry_date
     OR NEW.uploaded_by  IS DISTINCT FROM OLD.uploaded_by
     OR NEW.created_at   IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION 'REVIEW_FIELDS_ONLY: a reviewer may only change status/reviewed_by/reviewed_at/reject_reason'
      USING ERRCODE = 'P0020';
  END IF;

  IF OLD.status <> 'pending' THEN
    RAISE EXCEPTION 'ALREADY_REVIEWED: % has already been reviewed — re-upload to try again', OLD.id
      USING ERRCODE = 'P0021';
  END IF;

  IF NEW.status NOT IN ('verified','rejected') THEN
    RAISE EXCEPTION 'INVALID_REVIEW_STATUS: status must become verified or rejected'
      USING ERRCODE = 'P0022';
  END IF;

  -- Belt-and-suspenders: structurally the uploader can never pass
  -- can_review_documents() (document_reviewer is tenant-less, so it can
  -- never also satisfy owns_document_target()'s tenant match) — this catches
  -- the one edge case where roles could coincide: an admin who uploaded on a
  -- tenant's behalf reviewing their own upload.
  IF NEW.uploaded_by IS NOT NULL AND NEW.uploaded_by = auth.uid() THEN
    RAISE EXCEPTION 'NO_SELF_VERIFY: cannot review your own uploaded document'
      USING ERRCODE = 'P0019';
  END IF;

  NEW.reviewed_by := auth.uid();
  NEW.reviewed_at := now();
  RETURN NEW;
END;
$$;

-- ─────────────────────────────────────────────────────────────
-- B. review_pending_application() — set the GUC immediately before the
--    reparenting UPDATE it already performs. Everything else unchanged.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.review_pending_application(
  p_application_id uuid,
  p_decision text,
  p_reject_reason text DEFAULT NULL
)
RETURNS TABLE (
  status                          text,
  resulting_company_id            uuid,
  resulting_transport_company_id  uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_reviewer_role public.member_role;
  v_app public.pending_applications;
  v_new_tenant_id uuid;
BEGIN
  v_reviewer_role := (public.my_membership()).role;
  IF v_reviewer_role NOT IN ('document_reviewer', 'system_admin', 'admin', 'super_admin') THEN
    RAISE EXCEPTION 'FORBIDDEN: only document_reviewer/system_admin/admin/super_admin may review applications'
      USING ERRCODE = '42501';
  END IF;

  IF p_decision NOT IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'invalid decision: must be ''approved'' or ''rejected''';
  END IF;

  SELECT * INTO v_app FROM public.pending_applications WHERE id = p_application_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'application not found';
  END IF;

  IF v_app.status <> 'pending_review' THEN
    RAISE EXCEPTION 'application is not awaiting review (current status: %)', v_app.status;
  END IF;

  -- Approver must differ from the applicant — defense in depth against the
  -- pathological case where a reviewer role is somehow granted to the
  -- applicant's own account.
  IF auth.uid() = v_app.applicant_user_id THEN
    RAISE EXCEPTION 'FORBIDDEN: a reviewer cannot approve or reject their own application'
      USING ERRCODE = '42501';
  END IF;

  IF p_decision = 'rejected' THEN
    IF p_reject_reason IS NULL OR btrim(p_reject_reason) = '' THEN
      RAISE EXCEPTION 'reject_reason is required when rejecting an application';
    END IF;

    UPDATE public.pending_applications
    SET status = 'rejected', reviewed_by = auth.uid(), reviewed_at = now(), reject_reason = p_reject_reason
    WHERE id = p_application_id;

    UPDATE public.memberships
    SET revoked_at = now(), revoked_by = auth.uid(),
        revoke_reason = 'Application rejected: ' || p_reject_reason
    WHERE user_id = v_app.applicant_user_id AND role = 'applicant' AND revoked_at IS NULL;

    INSERT INTO public.audit_log (user_id, tenant_id, tenant_type, action, entity_type, entity_id, changes)
    VALUES (
      auth.uid(), NULL, 'admin', 'reject_pending_application', 'pending_applications', p_application_id,
      jsonb_build_object('applicant_user_id', v_app.applicant_user_id, 'reject_reason', p_reject_reason)
    );

    RETURN QUERY SELECT 'rejected'::text, NULL::uuid, NULL::uuid;
    RETURN;
  END IF;

  -- decision = 'approved'
  IF v_app.tenant_type = 'company' THEN
    INSERT INTO public.companies (name_ar, name_en, commercial_registration, vat_number, industry_code)
    VALUES (v_app.name_ar, v_app.name_en, v_app.commercial_registration, v_app.vat_number, v_app.industry_code)
    RETURNING id INTO v_new_tenant_id;
  ELSE
    INSERT INTO public.transport_companies (name_ar, name_en, commercial_registration)
    VALUES (v_app.name_ar, v_app.name_en, v_app.commercial_registration)
    RETURNING id INTO v_new_tenant_id;
  END IF;

  UPDATE public.pending_applications
  SET status = 'approved', reviewed_by = auth.uid(), reviewed_at = now(),
      resulting_company_id = CASE WHEN v_app.tenant_type = 'company' THEN v_new_tenant_id END,
      resulting_transport_company_id = CASE WHEN v_app.tenant_type = 'transport_company' THEN v_new_tenant_id END
  WHERE id = p_application_id;

  UPDATE public.memberships
  SET revoked_at = now(), revoked_by = auth.uid(),
      revoke_reason = 'Application approved — promoted to owner membership'
  WHERE user_id = v_app.applicant_user_id AND role = 'applicant' AND revoked_at IS NULL;

  INSERT INTO public.memberships (user_id, role, company_id, transport_company_id)
  VALUES (
    v_app.applicant_user_id, 'owner',
    CASE WHEN v_app.tenant_type = 'company' THEN v_new_tenant_id END,
    CASE WHEN v_app.tenant_type = 'transport_company' THEN v_new_tenant_id END
  );

  -- Re-parent the SAME document rows (preserves reviewed_by/reviewed_at/
  -- status history) rather than requiring re-upload+re-review. The GUC set
  -- immediately below is what documents_before_update()'s narrow exception
  -- (migration 040) actually checks — transaction-local, so it only exists
  -- for the duration of THIS call, and names THIS application specifically.
  -- No plain client .update() — from a reviewer session or otherwise — can
  -- ever set it, so the exception branch is unreachable from outside this
  -- function.
  PERFORM set_config('sanad.reparenting_application_id', p_application_id::text, true);
  UPDATE public.documents
  SET owner_type = v_app.tenant_type, owner_id = v_new_tenant_id
  WHERE owner_type = 'pending_application' AND owner_id = p_application_id;

  INSERT INTO public.audit_log (user_id, tenant_id, tenant_type, action, entity_type, entity_id, changes)
  VALUES (
    auth.uid(), v_new_tenant_id, v_app.tenant_type, 'approve_pending_application', 'pending_applications', p_application_id,
    jsonb_build_object(
      'applicant_user_id', v_app.applicant_user_id,
      'tenant_type', v_app.tenant_type,
      'resulting_tenant_id', v_new_tenant_id
    )
  );

  RETURN QUERY SELECT
    'approved'::text,
    CASE WHEN v_app.tenant_type = 'company' THEN v_new_tenant_id END,
    CASE WHEN v_app.tenant_type = 'transport_company' THEN v_new_tenant_id END;
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- END OF MIGRATION 040
-- ═══════════════════════════════════════════════════════════════════════════
