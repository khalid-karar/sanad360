-- ═══════════════════════════════════════════════════════════════════════════
-- Sanad 360 – Migration 026: pickup_confirmations (branch-operator attestation)
--
-- CP5 item 1: a NEW, separate append-only table — NOT columns added to
-- pickup_events. pickup_events is the driver's own append-only ledger row;
-- a second party's (branch_operator's) attestation belongs in a second
-- party's own row, exactly the same reasoning that gave disposal_confirmations
-- its own table (010/018) instead of writing recycler-side fields onto
-- pickup_events. This migration mirrors that precedent's shape closely:
-- BEFORE INSERT forces the tenant-scoping columns from the referenced row
-- (never trusts client input for them), AFTER INSERT writes one audit_log
-- row, UPDATE/DELETE are revoked entirely.
--
-- IMPORTANT SCOPE NOTE ("which methods count as sufficient is a CP3
-- evidence_requirements setting — do NOT hardcode"): pickup_confirmations is
-- necessarily written AFTER pickup_events (the confirmation is a separate,
-- later, async step — a branch_operator confirms what the driver already
-- recorded). pickup_events_before_insert (022) computes compliance_status at
-- INSERT time, before any confirmation can possibly exist yet, and
-- pickup_events is immutable (no UPDATE grant) — so a pickup_event's
-- compliance_status can NEVER be retroactively changed once a confirmation
-- lands, the same way disposal_confirmations' custody-completeness is
-- computed at READ time (review queue / gov reporting), not written back
-- onto pickup_events. This migration therefore:
--   (a) widens evidence_requirements.required_items to allow a new
--       'branch_confirmation' value, so a tenant CAN declare "a branch
--       confirmation is required for this waste stream" — consumed by
--       read-time reporting logic (review queue, gov aggregates) in the
--       app-code phase, exactly like custody_missing today.
--   (b) adds a SEPARATE small config table, confirmation_method_policy,
--       answering a different question — given a confirmation exists, does
--       ITS method count as sufficient (vs "reduced verification")? This is
--       deliberately a 2-tier (global default + optional per-transport-
--       company override) config, simpler than evidence_requirements' 4-tier
--       (method sufficiency doesn't vary by waste_stream) — flagging this as
--       a scope choice, open to revisiting if a real need for per-stream
--       method policy emerges.
-- Neither (a) nor (b) is wired into pickup_events_before_insert or any
-- trigger in this migration — both are pure config, consumed by app-code
-- reporting logic in the next phase. This is a deliberate architectural
-- choice, not an oversight.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────
-- A. pickup_confirmations table
-- ─────────────────────────────────────────────────────────────
CREATE TABLE public.pickup_confirmations (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  pickup_event_id   uuid        NOT NULL UNIQUE REFERENCES public.pickup_events(id),
  -- Generator-side tenant scope, server-forced (BEFORE INSERT below) from
  -- the referenced pickup_event — never trusted from the client, exactly
  -- mirroring disposal_confirmations_before_insert forcing facility_id/
  -- transport_company_id from the trip regardless of client input.
  branch_id         uuid        NOT NULL REFERENCES public.branches(id),
  company_id        uuid        NOT NULL REFERENCES public.companies(id),
  confirmed_by      uuid        REFERENCES public.profiles(id),
  confirmed_at      timestamptz,
  method            text        NOT NULL
                                CHECK (method IN ('in_app_confirm', 'signature_on_driver_device', 'unavailable')),
  signature_path    text,
  signature_sha256  text,
  gps_lat           numeric(10,7),
  gps_lng           numeric(10,7),
  gps_accuracy_m    numeric(6,1),
  status            text        NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'disputed')),
  dispute_reason    text,
  -- Doubles as the mandatory explanation for method='unavailable' (see CHECK
  -- below) — reusing a single free-text column rather than adding a third,
  -- mirroring 022's qr_skip_reason_notes convention for its 'other' value.
  notes             text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pickup_confirmations_status_fields_check CHECK (
    (status = 'confirmed' AND dispute_reason IS NULL)
    OR (status = 'disputed' AND dispute_reason IS NOT NULL)
  ),
  CONSTRAINT pickup_confirmations_unavailable_requires_notes CHECK (
    method <> 'unavailable' OR (notes IS NOT NULL AND length(trim(notes)) > 0)
  )
);

CREATE INDEX pickup_confirmations_branch_idx ON public.pickup_confirmations(branch_id, confirmed_at DESC);
CREATE INDEX pickup_confirmations_company_idx ON public.pickup_confirmations(company_id, confirmed_at DESC);

-- ─────────────────────────────────────────────────────────────
-- B. BEFORE INSERT — force tenant scope + actor/timestamp from the server,
--    never the client. Same shape as disposal_confirmations_before_insert
--    (018, lines 659-691).
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.pickup_confirmations_before_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_event public.pickup_events%ROWTYPE;
BEGIN
  SELECT * INTO v_event FROM public.pickup_events WHERE id = NEW.pickup_event_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PICKUP_EVENT_NOT_FOUND: pickup_event_id % does not exist', NEW.pickup_event_id
      USING ERRCODE = 'P0002';
  END IF;

  NEW.branch_id  := v_event.branch_id;
  NEW.company_id := v_event.company_id;

  IF auth.uid() IS NOT NULL THEN
    NEW.confirmed_by := auth.uid();
  END IF;
  NEW.confirmed_at := now();

  RETURN NEW;
END;
$$;

CREATE TRIGGER pickup_confirmations_before_insert
  BEFORE INSERT ON public.pickup_confirmations
  FOR EACH ROW EXECUTE FUNCTION public.pickup_confirmations_before_insert();

-- ─────────────────────────────────────────────────────────────
-- C. AFTER INSERT — one audit_log row, same shape as
--    disposal_confirmations_after_insert (018, lines 694-718).
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.pickup_confirmations_after_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.audit_log (user_id, tenant_id, tenant_type, action, entity_type, entity_id)
  VALUES (
    NEW.confirmed_by, NEW.company_id, 'company',
    CASE WHEN NEW.status = 'confirmed' THEN 'create_pickup_confirmation' ELSE 'dispute_pickup_confirmation' END,
    'pickup_confirmations', NEW.id
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER pickup_confirmations_after_insert
  AFTER INSERT ON public.pickup_confirmations
  FOR EACH ROW EXECUTE FUNCTION public.pickup_confirmations_after_insert();

-- ─────────────────────────────────────────────────────────────
-- D. Append-only: GRANT SELECT+INSERT only, REVOKE UPDATE/DELETE — same
--    shape as disposal_confirmations (010, lines 114-116).
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.pickup_confirmations ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT ON public.pickup_confirmations TO authenticated;
GRANT ALL ON public.pickup_confirmations TO service_role;
REVOKE UPDATE, DELETE ON public.pickup_confirmations FROM authenticated, anon;

-- SELECT: company-side members of the generator (branch_operator included,
-- same as any other company-side role), OR the transporter that hauled the
-- pickup (joined via pickup_events, since transport_company_id isn't stored
-- directly here — mirrors disposal_confirmations_select's join back to
-- pickup_events for the generator-side check, just the mirror image), OR
-- admin.
CREATE POLICY pickup_confirmations_select ON public.pickup_confirmations
  FOR SELECT TO authenticated
  USING (
    (public.my_membership()).role = 'admin'
    OR company_id = (public.my_membership()).company_id
    OR EXISTS (
      SELECT 1 FROM public.pickup_events pe
      WHERE pe.id = pickup_confirmations.pickup_event_id
        AND pe.transport_company_id = (public.my_membership()).transport_company_id
    )
  );

-- INSERT: only a branch_operator whose OWN branch_id matches the branch
-- being confirmed. Note branch_id here is checked against the CLIENT-
-- supplied value at RLS-evaluation time, which happens AFTER the BEFORE
-- INSERT trigger above has already overwritten it from the pickup_event —
-- so this check is really "the pickup_event's actual branch equals the
-- caller's own branch," not anything the client could spoof. Driver/
-- dispatcher/owner/manager are excluded by construction (not this role),
-- exactly the same "no new DENY needed, excluded by omission" pattern noted
-- for support_agent in migration 025.
CREATE POLICY pickup_confirmations_insert ON public.pickup_confirmations
  FOR INSERT TO authenticated
  WITH CHECK (
    (public.my_membership()).role = 'branch_operator'
    AND branch_id = (public.my_membership()).branch_id
    AND confirmed_by = auth.uid()
  );

-- ─────────────────────────────────────────────────────────────
-- E. STORAGE: pickup-confirmation-signatures bucket (private, append-only,
--    branch-scoped). Path convention: {branch_id}/{pickup_event_id}/{file}.
--    A dedicated bucket (not the driver's pickup-signatures bucket) because
--    the actor and prefix-authorization scheme are different — mirrors
--    018's decision to give weighbridge-photos its own bucket/policy pair
--    rather than joining the combined company-prefix evidence policy.
-- ─────────────────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public)
VALUES ('pickup-confirmation-signatures', 'pickup-confirmation-signatures', false)
ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.storage_pickup_confirmation_prefix_allowed(p_branch_folder text, p_event_folder text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(
    (public.my_membership()).role = 'admin'
    OR (public.my_membership()).branch_id::text = p_branch_folder
    OR (public.my_membership()).company_id IN (
      SELECT b.company_id FROM public.branches b WHERE b.id::text = p_branch_folder
    )
    OR EXISTS (
      SELECT 1 FROM public.pickup_events pe
      WHERE pe.id::text = p_event_folder
        AND pe.branch_id::text = p_branch_folder
        AND pe.transport_company_id = (public.my_membership()).transport_company_id
    ),
    false
  );
$$;

GRANT EXECUTE ON FUNCTION public.storage_pickup_confirmation_prefix_allowed(text, text) TO authenticated;

CREATE POLICY pickup_confirmation_signatures_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'pickup-confirmation-signatures'
    AND (public.my_membership()).role = 'branch_operator'
    AND (public.my_membership()).branch_id::text = (storage.foldername(name))[1]
  );

CREATE POLICY pickup_confirmation_signatures_select ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'pickup-confirmation-signatures'
    AND public.storage_pickup_confirmation_prefix_allowed(
      (storage.foldername(name))[1],
      (storage.foldername(name))[2]
    )
  );

-- Append-only for this bucket too, bucket-agnostically, via 005's
-- evidence_no_update / evidence_no_delete policies (no bucket_id filter —
-- they apply to all of storage.objects). No new policy needed here.

-- ─────────────────────────────────────────────────────────────
-- F. evidence_requirements: widen the allowed required_items values to
--    include 'branch_confirmation' — consumed by app-code reporting logic
--    (review queue / gov aggregates), NOT by pickup_events_before_insert
--    (see migration header: a confirmation cannot exist at pickup_events
--    INSERT time, so it cannot affect that row's compliance_status).
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.evidence_requirements DROP CONSTRAINT evidence_requirements_items_check;
ALTER TABLE public.evidence_requirements ADD CONSTRAINT evidence_requirements_items_check CHECK (
  array_length(required_items, 1) > 0
  AND required_items <@ ARRAY['qr', 'geofenced_gps', 'photo', 'receipt', 'signature', 'scale_photo', 'branch_confirmation']::text[]
);

-- ─────────────────────────────────────────────────────────────
-- G. confirmation_method_policy — is a given confirmation METHOD sufficient
--    (vs "reduced verification")? A different question from "is a
--    confirmation required at all" (F, above). Global default + optional
--    per-transport-company override, same two-tier shape as
--    evidence_requirements' tenant-override tier (022), minus the
--    per-waste-stream dimension (deliberately simpler — see migration
--    header).
-- ─────────────────────────────────────────────────────────────
CREATE TABLE public.confirmation_method_policy (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  transport_company_id  uuid        REFERENCES public.transport_companies(id),
  method                text        NOT NULL
                                    CHECK (method IN ('in_app_confirm', 'signature_on_driver_device', 'unavailable')),
  is_sufficient         boolean     NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX confirmation_method_policy_tenant_uidx
  ON public.confirmation_method_policy(transport_company_id, method)
  WHERE transport_company_id IS NOT NULL;
CREATE UNIQUE INDEX confirmation_method_policy_global_uidx
  ON public.confirmation_method_policy(method)
  WHERE transport_company_id IS NULL;

-- Seeded global defaults: in-app confirmation is fully sufficient; a
-- signature captured on the driver's own device is the explicitly weaker
-- legacy fallback (per CP5 spec); no confirmation at all is never
-- sufficient by default (a tenant can override per transport_company via a
-- normal INSERT if a real business reason ever justifies it — none does
-- today).
INSERT INTO public.confirmation_method_policy (transport_company_id, method, is_sufficient) VALUES
  (NULL, 'in_app_confirm', true),
  (NULL, 'signature_on_driver_device', false),
  (NULL, 'unavailable', false);

ALTER TABLE public.confirmation_method_policy ENABLE ROW LEVEL SECURITY;

CREATE POLICY confirmation_method_policy_select ON public.confirmation_method_policy
  FOR SELECT TO authenticated
  USING (
    transport_company_id IS NULL
    OR transport_company_id = (public.my_membership()).transport_company_id
    OR (public.my_membership()).role = 'admin'
  );

GRANT SELECT ON public.confirmation_method_policy TO authenticated;
GRANT ALL ON public.confirmation_method_policy TO service_role;
-- INSERT/UPDATE: service_role / admin console only, same as
-- evidence_requirements (022).

-- ═══════════════════════════════════════════════════════════════════════════
-- END OF MIGRATION 026
-- ═══════════════════════════════════════════════════════════════════════════
