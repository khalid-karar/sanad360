-- ═══════════════════════════════════════════════════════════════════════════
-- Sanad 360 – Migration 039: fix regression in owns_document_target() (035)
-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 035's CREATE OR REPLACE of owns_document_target() was built from
-- a truncated read of 021's original (a grep cut off mid-function) and
-- silently dropped two real, load-bearing branches:
--
--   1. The 'driver' case's `OR EXISTS (... d.profile_id = auth.uid())`
--      clause — the path that lets a driver upload THEIR OWN documents
--      regardless of role. Without it, only owner/manager/dispatcher could
--      upload a driver's documents — every driver uploading their own iqama
--      etc. was broken. Caught by cp2-document-gating.test.ts's "uploader
--      cannot self-verify their own document" test, which failed at the
--      INSERT step (42501) before ever reaching the self-verify assertion
--      it's actually testing.
--   2. The entire `WHEN 'facility' THEN RETURN m.role = 'recycler_manager'
--      AND m.facility_id = p_owner_id;` branch — recycler_manager document
--      uploads for their facility were broken (silently fell through to the
--      ELSE false branch, same as any unrecognized owner_type).
--
-- can_view_document_target() and storage_document_prefix_allowed() (also
-- touched by 035) were re-checked against 021's full originals and are
-- correct — both already had their driver-self and facility handling nested
-- differently (embedded in the driver branch's own EXISTS/OR, not a
-- separate outer clause), and 035's versions of those two match exactly.
-- Only owns_document_target() was wrong. This migration restores both
-- missing pieces verbatim from 021, on top of the pending_application
-- branch 035 added.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.owns_document_target(p_owner_type text, p_owner_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  m public.memberships;
BEGIN
  m := public.my_membership();
  IF m.role = 'admin' THEN
    RETURN true;
  END IF;

  CASE p_owner_type
    WHEN 'company' THEN
      RETURN m.role IN ('owner','manager') AND m.company_id = p_owner_id;
    WHEN 'branch' THEN
      RETURN m.role IN ('owner','manager') AND EXISTS (
        SELECT 1 FROM public.branches b WHERE b.id = p_owner_id AND b.company_id = m.company_id
      );
    WHEN 'transport_company' THEN
      RETURN m.role IN ('owner','manager') AND m.transport_company_id = p_owner_id;
    WHEN 'vehicle' THEN
      RETURN m.role IN ('owner','manager') AND EXISTS (
        SELECT 1 FROM public.vehicles v WHERE v.id = p_owner_id AND v.transport_company_id = m.transport_company_id
      );
    WHEN 'driver' THEN
      RETURN (
        m.role IN ('owner','manager','dispatcher') AND EXISTS (
          SELECT 1 FROM public.drivers d WHERE d.id = p_owner_id AND d.transport_company_id = m.transport_company_id
        )
      ) OR EXISTS (
        SELECT 1 FROM public.drivers d WHERE d.id = p_owner_id AND d.profile_id = auth.uid()
      );
    WHEN 'facility' THEN
      RETURN m.role = 'recycler_manager' AND m.facility_id = p_owner_id;
    WHEN 'pending_application' THEN
      RETURN m.role = 'applicant' AND EXISTS (
        SELECT 1 FROM public.pending_applications pa
        WHERE pa.id = p_owner_id AND pa.applicant_user_id = auth.uid()
      );
    ELSE
      RETURN false;
  END CASE;
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- END OF MIGRATION 039
-- ═══════════════════════════════════════════════════════════════════════════
