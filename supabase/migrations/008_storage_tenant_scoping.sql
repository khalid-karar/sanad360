-- ═══════════════════════════════════════════════════════════════════════════
-- Sanad 360 – Migration 008: Tenant-scoped storage policies
-- ═══════════════════════════════════════════════════════════════════════════
-- FIXES A CROSS-TENANT LEAK: migration 005's evidence_select / evidence_insert
-- granted EVERY authenticated user SELECT/INSERT on ALL objects in the four
-- buckets, with no tenant scoping. Any signed-in user of any tenant could
-- list() and createSignedUrl() another company's photos, signatures, receipts
-- and inspection PDFs.
--
-- Evidence object paths are canonical (src/lib/api/storage.ts buildPath):
--     {company_id}/{branch_id}/{pickup_event_id}/{type}.{ext}
-- Inspection PDF paths (services/pdf/src/lib/storage.ts uploadPdf):
--     {company_id}/{branch_id}/{filename}.pdf
-- so the first folder component is always the owning company's UUID. Policies
-- below scope every read/write to that prefix.
--
-- Access matrix after this migration:
--   evidence buckets (pickup-photos / pickup-signatures / pickup-receipts):
--     • admin ................................ read + write, all prefixes
--     • company member ....................... read + write, own company prefix
--     • transport-company member ............. read + write, prefixes of
--       companies ACTIVELY linked via company_transporters (drivers upload
--       evidence into the serviced company's prefix)
--   inspection-pdfs:
--     • admin / company member (own prefix) .. read only
--     • transport members .................... NO access (mirrors the
--       inspection_pdfs table RLS, which is company + admin only)
--     • writes ............................... service_role only (PDF service)
--
-- Objects with no folder prefix fail closed: (storage.foldername(name))[1]
-- is NULL for root-level objects, and the helper returns false for NULL.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────
-- 1. Helper: may the caller touch objects under this company prefix?
--    SECURITY DEFINER so the company_transporters lookup does not depend on
--    that table's own RLS; search_path locked (same pattern as my_membership).
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.storage_company_prefix_allowed(p_company_folder text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(
    (public.my_membership()).role = 'admin'
    OR (public.my_membership()).company_id::text = p_company_folder
    OR EXISTS (
      SELECT 1
      FROM public.company_transporters ct
      WHERE ct.status = 'active'
        AND ct.transport_company_id = (public.my_membership()).transport_company_id
        AND ct.company_id::text = p_company_folder
    ),
    false
  );
$$;

GRANT EXECUTE ON FUNCTION public.storage_company_prefix_allowed(text) TO authenticated;

-- ─────────────────────────────────────────────────────────────
-- 2. Replace the bucket-wide 005 policies with tenant-scoped ones.
--    evidence_no_update / evidence_no_delete from 005 are kept as-is
--    (append-only storage remains enforced).
-- ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS evidence_insert ON storage.objects;
DROP POLICY IF EXISTS evidence_select ON storage.objects;

CREATE POLICY evidence_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id IN ('pickup-photos','pickup-signatures','pickup-receipts')
    AND public.storage_company_prefix_allowed((storage.foldername(name))[1])
  );

CREATE POLICY evidence_select ON storage.objects
  FOR SELECT TO authenticated
  USING (
    (
      bucket_id IN ('pickup-photos','pickup-signatures','pickup-receipts')
      AND public.storage_company_prefix_allowed((storage.foldername(name))[1])
    )
    OR (
      bucket_id = 'inspection-pdfs'
      AND (
        (public.my_membership()).role = 'admin'
        OR (public.my_membership()).company_id::text = (storage.foldername(name))[1]
      )
    )
  );

-- ═══════════════════════════════════════════════════════════════════════════
-- END OF MIGRATION 008
-- ═══════════════════════════════════════════════════════════════════════════
