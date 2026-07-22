-- ═══════════════════════════════════════════════════════════════════════════
-- Sanad 360 – Migration 037: CP5.5 fix — pending_application document uploads
-- ═══════════════════════════════════════════════════════════════════════════
-- 035 extended documents/required_documents' owner_type CHECK and the three
-- RLS-gating helper functions (owns_document_target, can_view_document_target,
-- storage_document_prefix_allowed) to recognize 'pending_application', but
-- missed two things documents_before_insert() (021) ALSO enforces on every
-- insert, independent of RLS — caught by the new test's document-upload
-- assertion (OWNER_NOT_FOUND, then would have hit UNKNOWN_DOC_TYPE next):
--
--   A. Its OWN owner-existence check is a separate CASE statement (not a
--      real FK — owner_id is polymorphic across owner_types, so it can't
--      be one) that didn't have a 'pending_application' branch, silently
--      falling through to its ELSE (false) — i.e. every pending_application
--      document upload was being rejected as "owner not found" even though
--      RLS would have allowed it.
--   B. It also requires doc_type to be a configured required_documents row
--      for that exact owner_type — 035 deliberately did NOT seed any
--      required_documents rows for 'pending_application' (deferring "which
--      doc list to show" to the future UI, based on tenant_type), which
--      means NO document upload could ever succeed for owner_type=
--      'pending_application' at all, regardless of doc_type.
--
-- Fix for B: seed 'pending_application' with the union of what 'company'
-- and 'transport_company' already require (commercial_registration,
-- vat_certificate, ncwm_license) — permissive by design: an application is
-- for EITHER tenant type, and allowing a doc_type that turns out not to be
-- relevant for this particular application is harmless (the future UI only
-- PROMPTS for the subset matching the application's own tenant_type; the DB
-- just needs to not reject an upload that a real UI would never even offer).
--
-- KNOWN SIMPLIFICATION, confirmed safe as of this migration: grepped every
-- caller of owner_document_status() (src/lib/api/documents.ts,
-- DocumentChecklist.tsx, OnboardingPage.tsx, cp2-document-gating.test.ts) —
-- none passes owner_type='pending_application', and nothing in 034-037
-- calls it that way either. So this union is ONLY ever consulted as an
-- upload allowlist (documents_before_insert's UNKNOWN_DOC_TYPE check), never
-- as a completion-percentage denominator. If a future completion bar for
-- pending applications ever calls owner_document_status('pending_application',
-- ...), THAT is the point to split this into two owner_types (or otherwise
-- filter by tenant_type) — a company application would otherwise be judged
-- against transport_company's ncwm_license and vice versa. Not done here
-- because nothing consumes it that way yet.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────
-- A. documents_before_insert() — add the missing owner-existence branch.
--    Same function, same signature — CREATE OR REPLACE, no DROP needed.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.documents_before_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_owner_exists boolean;
BEGIN
  SELECT CASE NEW.owner_type
    WHEN 'company'              THEN EXISTS (SELECT 1 FROM public.companies WHERE id = NEW.owner_id)
    WHEN 'branch'                THEN EXISTS (SELECT 1 FROM public.branches WHERE id = NEW.owner_id)
    WHEN 'transport_company'    THEN EXISTS (SELECT 1 FROM public.transport_companies WHERE id = NEW.owner_id)
    WHEN 'driver'                THEN EXISTS (SELECT 1 FROM public.drivers WHERE id = NEW.owner_id)
    WHEN 'vehicle'               THEN EXISTS (SELECT 1 FROM public.vehicles WHERE id = NEW.owner_id)
    WHEN 'facility'              THEN EXISTS (SELECT 1 FROM public.facilities WHERE id = NEW.owner_id)
    WHEN 'pending_application'  THEN EXISTS (SELECT 1 FROM public.pending_applications WHERE id = NEW.owner_id)
    ELSE false
  END INTO v_owner_exists;

  IF NOT v_owner_exists THEN
    RAISE EXCEPTION 'OWNER_NOT_FOUND: % % does not exist', NEW.owner_type, NEW.owner_id
      USING ERRCODE = 'P0002';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.required_documents rd
    WHERE rd.owner_type = NEW.owner_type AND rd.doc_type = NEW.doc_type
  ) THEN
    RAISE EXCEPTION 'UNKNOWN_DOC_TYPE: % is not a configured document type for %', NEW.doc_type, NEW.owner_type
      USING ERRCODE = 'P0017';
  END IF;

  IF auth.uid() IS NOT NULL THEN
    NEW.uploaded_by := auth.uid();
  END IF;
  -- A fresh upload always starts pending review, regardless of client input —
  -- this is the actual mechanism that makes self-verification impossible.
  NEW.status        := 'pending';
  NEW.reviewed_by    := NULL;
  NEW.reviewed_at    := NULL;
  NEW.reject_reason  := NULL;

  RETURN NEW;
END;
$$;

-- ─────────────────────────────────────────────────────────────
-- B. required_documents seed for 'pending_application' — union of
--    company's + transport_company's current required doc_types.
-- ─────────────────────────────────────────────────────────────
INSERT INTO public.required_documents (owner_type, doc_type, label_ar, label_en)
SELECT DISTINCT ON (doc_type) 'pending_application', doc_type, label_ar, label_en
FROM public.required_documents
WHERE owner_type IN ('company', 'transport_company')
ORDER BY doc_type;

-- ═══════════════════════════════════════════════════════════════════════════
-- END OF MIGRATION 037
-- ═══════════════════════════════════════════════════════════════════════════
