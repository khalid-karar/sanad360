-- ═══════════════════════════════════════════════════════════════════════════
-- Sanad 360 – Migration 038: CP5.5 fix — document re-parenting on approval
-- ═══════════════════════════════════════════════════════════════════════════
-- review_pending_application() (035) re-parents pending_application-owned
-- documents onto the newly-created real tenant (UPDATE owner_type/owner_id).
-- documents_before_update() (021) blocks this outright — caught by the test:
-- REVIEW_FIELDS_ONLY (P0020), since owner_type/owner_id are two of the
-- columns that trigger locks to reviewer-only status/reviewed_by/
-- reviewed_at/reject_reason changes; even past that, OLD.status='pending'
-- would trip ALREADY_REVIEWED-adjacent logic and NEW.status not becoming
-- verified/rejected would trip INVALID_REVIEW_STATUS — because a re-parent
-- is architecturally a different OPERATION (an ownership transfer) than
-- what this trigger exists to gate (a human review decision), not a case
-- that trigger's existing logic can be coaxed into permitting.
--
-- REJECTED ALTERNATIVE: temporarily ALTER TABLE documents DISABLE TRIGGER
-- ... inside review_pending_application(), then re-enable. This table is
-- shared across every tenant; disabling its trigger for the duration of one
-- function call would also strip review-gating from any OTHER concurrent,
-- unrelated UPDATE on `documents` from a different session for that same
-- window — a real cross-tenant race, not a contained one-row exception.
--
-- FIX: one explicit, narrow exception at the top of
-- documents_before_update(), checked BEFORE any of the reviewer-decision
-- logic runs. Recognized ONLY as: OLD.owner_type = 'pending_application' AND
-- NEW.owner_type IN ('company','transport_company') AND every other column
-- unchanged (doc_type, file_path, file_sha256, dates, status, reviewed_by,
-- reviewed_at, reject_reason, uploaded_by, created_at all IS NOT DISTINCT
-- FROM their OLD value). This can only ever widen to "move a
-- pending-application doc onto its approved tenant, preserving everything
-- else" — never a general "reviewers may also reparent documents"
-- capability, and never a path for a NON-reviewer to relabel a document
-- (can_review_documents() is still checked, belt-and-suspenders, even
-- though review_pending_application() already gates on reviewer role before
-- ever reaching this UPDATE).
-- ═══════════════════════════════════════════════════════════════════════════

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
    IF NOT public.can_review_documents() THEN
      RAISE EXCEPTION 'REVIEW_ONLY: only a document_reviewer or admin may re-parent a document'
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

-- ═══════════════════════════════════════════════════════════════════════════
-- END OF MIGRATION 038
-- ═══════════════════════════════════════════════════════════════════════════
