-- ═══════════════════════════════════════════════════════════════════════════
-- Sanad 360 – Migration 010: Disposal Confirmations (chain-of-custody leg)
-- ═══════════════════════════════════════════════════════════════════════════
-- The ledger previously ended at the generator's curb: a pickup_event proves
-- collection, but nothing proves the waste reached a disposal/treatment
-- facility — the question every real manifest system must answer.
--
-- disposal_confirmations is a second APPEND-ONLY evidence table, one row per
-- pickup event (UNIQUE), recorded by the transporter's driver at the facility:
-- facility identity, weighbridge ticket photo + SHA-256, GPS, timestamp.
--
-- Server-side trust boundary (mirrors pickup_events):
--   • created_by      – forced to auth.uid() by BEFORE INSERT trigger
--   • company_id / branch_id / transport_company_id – copied from the
--     referenced pickup event by the trigger; client values are ignored
--   • UPDATE / DELETE – revoked at the privilege layer (append-only)
--   • audit_log row   – written by AFTER INSERT trigger (SECURITY DEFINER)
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE public.disposal_confirmations (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- One confirmation per ledger event. Corrections of the pickup itself create
  -- a new revision (new event id), whose disposal can then be re-confirmed.
  pickup_event_id       uuid        NOT NULL UNIQUE REFERENCES public.pickup_events(id),

  -- Tenant scoping — server-set from the pickup event by the trigger.
  company_id            uuid        NOT NULL REFERENCES public.companies(id),
  branch_id             uuid        NOT NULL REFERENCES public.branches(id),
  transport_company_id  uuid        NOT NULL REFERENCES public.transport_companies(id),

  -- Receiving facility
  facility_name_ar        text      NOT NULL,
  facility_license_number text,

  -- Evidence
  ticket_path           text,
  ticket_sha256         text,
  gps_lat               numeric(10,7),
  gps_lng               numeric(10,7),

  notes                 text,
  created_by            uuid        REFERENCES public.profiles(id),
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX disposal_confirmations_company_idx
  ON public.disposal_confirmations(company_id, created_at DESC);
CREATE INDEX disposal_confirmations_tc_idx
  ON public.disposal_confirmations(transport_company_id, created_at DESC);

-- ─────────────────────────────────────────────────────────────
-- BEFORE INSERT: validate the event, force server-set fields
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.disposal_confirmations_before_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_event public.pickup_events%ROWTYPE;
BEGIN
  SELECT * INTO v_event
  FROM public.pickup_events
  WHERE id = NEW.pickup_event_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PICKUP_EVENT_NOT_FOUND: pickup_event_id % does not exist',
      NEW.pickup_event_id USING ERRCODE = 'P0002';
  END IF;

  -- Tenant fields come from the ledger event, never from the client.
  NEW.company_id           := v_event.company_id;
  NEW.branch_id            := v_event.branch_id;
  NEW.transport_company_id := v_event.transport_company_id;

  -- created_by = caller (not spoofable); service_role inserts may pass NULL.
  IF auth.uid() IS NOT NULL THEN
    NEW.created_by := auth.uid();
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER disposal_confirmations_before_insert_trigger
  BEFORE INSERT ON public.disposal_confirmations
  FOR EACH ROW EXECUTE FUNCTION public.disposal_confirmations_before_insert();

-- ─────────────────────────────────────────────────────────────
-- AFTER INSERT: audit trail (client cannot skip it)
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.disposal_confirmations_after_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.audit_log (user_id, tenant_id, tenant_type, action, entity_type, entity_id)
  VALUES (NEW.created_by, NEW.company_id, 'company',
          'create_disposal_confirmation', 'disposal_confirmations', NEW.id);
  RETURN NEW;
END;
$$;

CREATE TRIGGER disposal_confirmations_after_insert_trigger
  AFTER INSERT ON public.disposal_confirmations
  FOR EACH ROW EXECUTE FUNCTION public.disposal_confirmations_after_insert();

-- ─────────────────────────────────────────────────────────────
-- GRANTS + append-only revocation
-- ─────────────────────────────────────────────────────────────
GRANT SELECT, INSERT ON public.disposal_confirmations TO authenticated;
GRANT ALL ON public.disposal_confirmations TO service_role;
REVOKE UPDATE, DELETE ON public.disposal_confirmations FROM authenticated, anon;

-- ─────────────────────────────────────────────────────────────
-- RLS
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.disposal_confirmations ENABLE ROW LEVEL SECURITY;

CREATE POLICY disposal_confirmations_select ON public.disposal_confirmations
  FOR SELECT TO authenticated
  USING (
    company_id = (public.my_membership()).company_id
    OR transport_company_id = (public.my_membership()).transport_company_id
    OR (public.my_membership()).role = 'admin'
  );

-- INSERT: transport-side members only (the driver is at the facility).
-- The trigger has already forced company/branch/transport fields from the
-- ledger event, so the tenant check below is against server-set values.
CREATE POLICY disposal_confirmations_insert ON public.disposal_confirmations
  FOR INSERT TO authenticated
  WITH CHECK (
    created_by = auth.uid()
    AND transport_company_id = (public.my_membership()).transport_company_id
  );

-- ─────────────────────────────────────────────────────────────
-- Storage: disposal-tickets bucket (private, append-only, tenant-scoped)
-- Recreate the 008 evidence policies with the new bucket included; the
-- global evidence_no_update / evidence_no_delete from 005 already cover it.
-- ─────────────────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public)
VALUES ('disposal-tickets', 'disposal-tickets', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS evidence_insert ON storage.objects;
DROP POLICY IF EXISTS evidence_select ON storage.objects;

CREATE POLICY evidence_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id IN ('pickup-photos','pickup-signatures','pickup-receipts','disposal-tickets')
    AND public.storage_company_prefix_allowed((storage.foldername(name))[1])
  );

CREATE POLICY evidence_select ON storage.objects
  FOR SELECT TO authenticated
  USING (
    (
      bucket_id IN ('pickup-photos','pickup-signatures','pickup-receipts','disposal-tickets')
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
-- END OF MIGRATION 010
-- ═══════════════════════════════════════════════════════════════════════════
