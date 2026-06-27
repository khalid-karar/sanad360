-- ═══════════════════════════════════════════════════════════════════════════
-- Sanad 360 – Migration 005: Evidence-File Integrity
-- ═══════════════════════════════════════════════════════════════════════════
-- Adds tamper-evident SHA-256 columns to pickup_events, creates the private
-- evidence storage buckets, and locks those buckets to INSERT + SELECT only
-- (no UPDATE, no DELETE) for authenticated/anon — making uploaded evidence
-- append-only at the storage layer, mirroring the append-only pickup ledger.
--
-- Also re-affirms (and re-asserts as explicit DROP+CREATE) the 004 link-gated
-- SELECT policies on drivers/vehicles so the gating is unambiguous: a company
-- member may read a transporter's drivers/vehicles ONLY through an ACTIVE
-- company_transporters link. (004's versions were already correctly gated;
-- this re-states them idempotently. Migration 004 itself is left untouched.)
-- ═══════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────
-- 2a. SHA-256 columns on pickup_events
--
-- Client-supplied (computed in the browser at upload time) and NOT
-- server-re-validated — see REPORT "known limitation: server-side re-hashing
-- is future hardening". The append-only nature of pickup_events means a hash,
-- once written, can never be silently altered.
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.pickup_events
  ADD COLUMN IF NOT EXISTS photo_sha256     text,
  ADD COLUMN IF NOT EXISTS receipt_sha256   text,
  ADD COLUMN IF NOT EXISTS signature_sha256 text;

-- ─────────────────────────────────────────────────────────────
-- 2b. Evidence storage buckets (private)
--
-- Created here so the integrity policies + tests are self-contained. No
-- bucket-creation script existed previously. All three are private (public =
-- false); access is via short-lived signed URLs only.
-- ─────────────────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public)
VALUES
  ('pickup-photos',     'pickup-photos',     false),
  ('pickup-signatures', 'pickup-signatures', false),
  ('pickup-receipts',   'pickup-receipts',   false),
  ('inspection-pdfs',   'inspection-pdfs',   false)
ON CONFLICT (id) DO NOTHING;

-- ─────────────────────────────────────────────────────────────
-- 2b. Storage object policies — evidence buckets are append-only
--
-- INSERT  → authenticated may upload into the three evidence buckets.
-- SELECT  → authenticated may read evidence (for signed-URL generation / PDF).
-- UPDATE  → DENIED for authenticated + anon (no overwrite of evidence).
-- DELETE  → DENIED for authenticated + anon (no deletion of evidence).
--
-- service_role bypasses RLS, so the PDF service / backend can still manage
-- objects. inspection-pdfs is written by service_role only, so it needs no
-- authenticated INSERT policy.
-- ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS evidence_insert    ON storage.objects;
DROP POLICY IF EXISTS evidence_select    ON storage.objects;
DROP POLICY IF EXISTS evidence_no_update ON storage.objects;
DROP POLICY IF EXISTS evidence_no_delete ON storage.objects;

CREATE POLICY evidence_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id IN ('pickup-photos','pickup-signatures','pickup-receipts'));

CREATE POLICY evidence_select ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id IN ('pickup-photos','pickup-signatures','pickup-receipts','inspection-pdfs'));

-- Deny any UPDATE (overwrite) for authenticated + anon on evidence buckets.
CREATE POLICY evidence_no_update ON storage.objects
  FOR UPDATE TO authenticated, anon
  USING (false)
  WITH CHECK (false);

-- Deny any DELETE for authenticated + anon on evidence buckets.
CREATE POLICY evidence_no_delete ON storage.objects
  FOR DELETE TO authenticated, anon
  USING (false);

-- ─────────────────────────────────────────────────────────────
-- 2c. Re-affirm link-gated SELECT on drivers / vehicles
--
-- A company member sees a transporter's drivers/vehicles ONLY via an ACTIVE
-- company_transporters link. These restate 004's policies verbatim (which were
-- already correctly gated on status = 'active'); restating them makes the guard
-- explicit and ensures it survives independent of 004.
-- ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS drivers_select_for_linked_company  ON public.drivers;
CREATE POLICY drivers_select_for_linked_company
  ON public.drivers
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.company_transporters ct
      WHERE ct.status = 'active'
        AND ct.transport_company_id = drivers.transport_company_id
        AND ct.company_id = (public.my_membership()).company_id
    )
  );

DROP POLICY IF EXISTS vehicles_select_for_linked_company ON public.vehicles;
CREATE POLICY vehicles_select_for_linked_company
  ON public.vehicles
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.company_transporters ct
      WHERE ct.status = 'active'
        AND ct.transport_company_id = vehicles.transport_company_id
        AND ct.company_id = (public.my_membership()).company_id
    )
  );

-- ─────────────────────────────────────────────────────────────
-- 2d. Refresh pickup_events_latest view
--
-- PostgreSQL expands SELECT * at view-creation time; columns added via
-- ALTER TABLE after the view was created are NOT visible through the view
-- until it is replaced. Recreate to pick up photo/receipt/signature_sha256.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.pickup_events_latest
  WITH (security_invoker = true) AS
SELECT DISTINCT ON (logical_id) *
FROM public.pickup_events
ORDER BY logical_id, revision DESC;

-- ═══════════════════════════════════════════════════════════════════════════
-- END OF MIGRATION
-- ═══════════════════════════════════════════════════════════════════════════
