-- ═══════════════════════════════════════════════════════════════════════════
-- Sanad 360 – Migration 030: pending_confirmation — a pickup can never be
-- labeled compliant before an evidence-required branch confirmation lands
--
-- CP5 review's required change to 026: 026's original design left "which
-- methods count as sufficient" to be resolved at READ time (review queue /
-- gov reporting), meaning a pickup could sit as 'compliant' in the window
-- between insert and confirmation, and an inspection PDF generated in that
-- window would assert a compliance claim the evidence doesn't yet support.
-- Rejected. This migration makes the fork happen ONCE, server-side, at the
-- ledger row itself:
--
--   A. compliance_status gains a fourth value, 'pending_confirmation' — not
--      compliant, not non_compliant, a genuinely distinct third state.
--   B. pickup_events_before_insert (022): if evidence_requirements resolves
--      'branch_confirmation' as required for this pickup's stream/tenant,
--      the row inserts as 'pending_confirmation' (never 'compliant'), same
--      as any other required item forces 'non_compliant' today — this one
--      just has a middle state because, unlike photo/signature/qr, the
--      evidence in question CANNOT exist yet at insert time (a second
--      party's later attestation).
--   C. public.recompute_pickup_compliance(pickup_event_id) is the single
--      authority for every transition OUT of pending_confirmation. It is
--      the only place confirmation_method_policy is consulted — never at
--      read time. Called from:
--        - pickup_confirmations_after_insert (a confirmation just landed)
--        - sweep_expired_pickup_confirmations() (the "daily job" — see D)
--      It does NOT run from pickup_events_before_insert: at that moment the
--      row doesn't exist in the table yet (chicken-and-egg — recompute_*
--      always operates by reading-then-UPDATE-ing an EXISTING row), so the
--      BEFORE INSERT trigger computes the INITIAL value inline (B, above)
--      using the exact same evidence_requirements resolution machinery,
--      not a duplicated ad hoc check. recompute_pickup_compliance() is a
--      no-op for any row that ISN'T currently pending_confirmation — a
--      pickup already compliant/warning/non_compliant for reasons unrelated
--      to branch_confirmation is final at insert and is never touched here.
--   D. sweep_expired_pickup_confirmations() — the daily job. No pg_cron
--      wiring exists in this migration (this environment doesn't assume
--      pg_cron availability); this follows the EXACT precedent already
--      recorded in PRODUCTION_HARDENING.md for branch_qr_used_tokens
--      cleanup — a plain SECURITY DEFINER function, callable by pg_cron OR
--      an external cron hitting a service-role RPC, with the real
--      scheduling itself tracked as a concrete follow-up, not pretended
--      into existence here. Window is config
--      (confirmation_window_policy), not hardcoded — global default +
--      optional per-transport-company override, same 2-tier shape as
--      confirmation_method_policy (026).
--   E. Inspection PDF / review queue rendering pending_confirmation as its
--      own distinct state, and the custody section naming which party is
--      outstanding — APP CODE, next phase. Not touched here.
--
-- This migration also updates PRODUCTION_HARDENING.md with the sweep job's
-- entry (see repo root) — kept in the same file/format as the existing
-- branch_qr_used_tokens entry rather than a new document.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────
-- A. compliance_status: widen the CHECK (plain text column, not an enum —
--    unchanged from 001; no ADD-VALUE ceremony needed).
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.pickup_events DROP CONSTRAINT pickup_events_compliance_status_check;
ALTER TABLE public.pickup_events ADD CONSTRAINT pickup_events_compliance_status_check CHECK (
  compliance_status IN ('compliant', 'warning', 'non_compliant', 'pending_confirmation')
);

-- ─────────────────────────────────────────────────────────────
-- confirmation_window_policy — "the daily job window is config, not
-- hardcoded" (item d). Same 2-tier shape as confirmation_method_policy
-- (026): a single global default row, optionally overridden per transport
-- company. The partial unique index on a constant expression is the
-- standard Postgres idiom for "at most one row where X" when there's no
-- natural secondary key to dedupe against (unlike evidence_requirements/
-- confirmation_method_policy, which dedupe on waste_stream/method).
-- ─────────────────────────────────────────────────────────────
CREATE TABLE public.confirmation_window_policy (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  transport_company_id  uuid        REFERENCES public.transport_companies(id),
  window_hours          integer     NOT NULL CHECK (window_hours > 0),
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX confirmation_window_policy_tenant_uidx
  ON public.confirmation_window_policy(transport_company_id)
  WHERE transport_company_id IS NOT NULL;
CREATE UNIQUE INDEX confirmation_window_policy_global_uidx
  ON public.confirmation_window_policy((true))
  WHERE transport_company_id IS NULL;

INSERT INTO public.confirmation_window_policy (transport_company_id, window_hours) VALUES (NULL, 24);

ALTER TABLE public.confirmation_window_policy ENABLE ROW LEVEL SECURITY;

CREATE POLICY confirmation_window_policy_select ON public.confirmation_window_policy
  FOR SELECT TO authenticated
  USING (
    transport_company_id IS NULL
    OR transport_company_id = (public.my_membership()).transport_company_id
    OR (public.my_membership()).role = 'admin'
  );

GRANT SELECT ON public.confirmation_window_policy TO authenticated;
GRANT ALL ON public.confirmation_window_policy TO service_role;
-- INSERT/UPDATE: service_role / admin console only, same posture as every
-- other config table in this migration family.

-- ─────────────────────────────────────────────────────────────
-- B. pickup_events_before_insert — replaces 022's version in place. Every
--    step through 6 (risk engine) is VERBATIM, unchanged. Step 6b (required-
--    evidence enforcement) is restructured: 'branch_confirmation' is added
--    to the SAME resolve_required_evidence() / v_missing_required machinery
--    as every other item (it is unconditionally "missing" at insert time —
--    nothing could have confirmed it yet), but the FINAL compliance_status
--    decision now separates "other required items missing" (still forces
--    non_compliant unconditionally — unchanged dominance from 022) from
--    "only branch_confirmation missing" (pending_confirmation — new).
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.pickup_events_before_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_branch              public.branches%ROWTYPE;
  v_driver              public.drivers%ROWTYPE;
  v_vehicle_tc_id       uuid;
  v_vehicle_expiry      date;
  v_dlat                double precision;
  v_dlng                double precision;
  v_a                   double precision;
  v_dist_m              double precision;
  v_acc_ok              boolean;
  v_score               integer := 0;
  v_flags               text[]  := '{}';

  -- (022) QR HMAC verification
  v_qr_parts            text[];
  v_payload_b64         text;
  v_sig_b64             text;
  v_expected_sig        text;
  v_payload_json        jsonb;
  v_qr_branch_id        uuid;
  v_qr_exp_ms           bigint;
  v_qr_ok               boolean := false;
  v_replay               boolean := false;

  -- (022) required-evidence enforcement
  v_required            text[];
  v_missing_required    text[] := '{}';
  v_missing_ex_confirm  text[];
  v_item                text;
BEGIN
  -- 1. Enforce created_by = caller (service_role may pass NULL).
  IF auth.uid() IS NOT NULL THEN
    NEW.created_by := auth.uid();
  END IF;

  -- 2. Branch belongs to company.
  SELECT * INTO v_branch FROM public.branches WHERE id = NEW.branch_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'BRANCH_NOT_FOUND: branch_id % does not exist', NEW.branch_id
      USING ERRCODE = 'P0002';
  END IF;
  IF v_branch.company_id <> NEW.company_id THEN
    RAISE EXCEPTION 'BRANCH_COMPANY_MISMATCH: branch_id % does not belong to company_id %',
      NEW.branch_id, NEW.company_id USING ERRCODE = 'P0003';
  END IF;

  -- 3. Driver belongs to transport_company.
  SELECT * INTO v_driver FROM public.drivers WHERE id = NEW.driver_id;
  IF NOT FOUND OR v_driver.transport_company_id <> NEW.transport_company_id THEN
    RAISE EXCEPTION 'DRIVER_TRANSPORT_MISMATCH: driver_id % does not belong to transport_company_id %',
      NEW.driver_id, NEW.transport_company_id USING ERRCODE = 'P0004';
  END IF;

  -- 4. Vehicle belongs to transport_company.
  SELECT transport_company_id, ncwm_license_expiry
    INTO v_vehicle_tc_id, v_vehicle_expiry
  FROM public.vehicles WHERE id = NEW.vehicle_id;
  IF NOT FOUND OR v_vehicle_tc_id <> NEW.transport_company_id THEN
    RAISE EXCEPTION 'VEHICLE_TRANSPORT_MISMATCH: vehicle_id % does not belong to transport_company_id %',
      NEW.vehicle_id, NEW.transport_company_id USING ERRCODE = 'P0005';
  END IF;

  -- 4b. (018) trip_id, if provided, must belong to the same transport_company.
  IF NEW.trip_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.trips t
      WHERE t.id = NEW.trip_id AND t.transport_company_id = NEW.transport_company_id
    ) THEN
      RAISE EXCEPTION 'TRIP_TRANSPORT_MISMATCH: trip_id % does not belong to transport_company_id %',
        NEW.trip_id, NEW.transport_company_id USING ERRCODE = 'P0009';
    END IF;
  END IF;

  -- 4c. (021) A non-exempt driver/vehicle that isn't ACTIVE (onboarding OR
  -- restricted) may not complete a pickup — mirrors the pickup_assignments gate.
  IF public.is_owner_operationally_blocked('driver', NEW.driver_id) THEN
    RAISE EXCEPTION 'DRIVER_NOT_ACTIVE: driver % does not have complete, current, verified required documents and cannot complete a pickup', NEW.driver_id
      USING ERRCODE = 'P0023';
  END IF;
  IF public.is_owner_operationally_blocked('vehicle', NEW.vehicle_id) THEN
    RAISE EXCEPTION 'VEHICLE_NOT_ACTIVE: vehicle % does not have complete, current, verified required documents and cannot complete a pickup', NEW.vehicle_id
      USING ERRCODE = 'P0024';
  END IF;

  -- 5. Geofence: distance AND credible accuracy (fail closed).
  IF NEW.gps_lat IS NULL
     OR NEW.gps_lng IS NULL
     OR v_branch.geofence_lat IS NULL
     OR v_branch.geofence_lng IS NULL
  THEN
    NEW.geofence_verified := false;
  ELSE
    v_dlat   := radians(NEW.gps_lat::double precision - v_branch.geofence_lat::double precision);
    v_dlng   := radians(NEW.gps_lng::double precision - v_branch.geofence_lng::double precision);
    v_a      := sin(v_dlat / 2) ^ 2
              + cos(radians(v_branch.geofence_lat::double precision))
              * cos(radians(NEW.gps_lat::double precision))
              * sin(v_dlng / 2) ^ 2;
    v_dist_m := 2 * 6371000 * asin(sqrt(v_a));
    v_acc_ok := NEW.gps_accuracy_m IS NOT NULL
                AND NEW.gps_accuracy_m <= v_branch.geofence_radius_m;
    NEW.geofence_verified :=
      (v_dist_m <= v_branch.geofence_radius_m::double precision) AND v_acc_ok;
  END IF;

  -- 5b. (022) Dynamic branch QR: HMAC-verify against the branch's secret
  -- (branches.qr_token, never displayed to any client — decision 6 above),
  -- check branch match + TTL, then consume the token exactly once via
  -- branch_qr_used_tokens (decision 2 above) — replay fails closed.
  IF NEW.qr_code_value IS NOT NULL THEN
    v_qr_parts := regexp_split_to_array(NEW.qr_code_value, '\.');
    IF array_length(v_qr_parts, 1) = 2 THEN
      v_payload_b64 := v_qr_parts[1];
      v_sig_b64     := v_qr_parts[2];
      BEGIN
        v_expected_sig := replace(replace(encode(
            extensions.hmac(convert_to(v_payload_b64, 'UTF8'), convert_to(v_branch.qr_token::text, 'UTF8'), 'sha256'),
            'base64'
          ), E'\n', ''), E'\r', '');

        IF v_sig_b64 = v_expected_sig THEN
          v_payload_json := convert_from(decode(v_payload_b64, 'base64'), 'UTF8')::jsonb;
          v_qr_branch_id := (v_payload_json->>'branch_id')::uuid;
          v_qr_exp_ms    := (v_payload_json->>'exp')::bigint;

          IF v_qr_branch_id = NEW.branch_id
             AND v_qr_exp_ms > (extract(epoch FROM now()) * 1000)::bigint
          THEN
            INSERT INTO public.branch_qr_used_tokens (signature, branch_id, expires_at)
            VALUES (v_sig_b64, NEW.branch_id, to_timestamp(v_qr_exp_ms / 1000.0))
            ON CONFLICT (signature) DO NOTHING;
            IF FOUND THEN
              v_qr_ok := true;
            ELSE
              v_replay := true;
            END IF;
          END IF;
        END IF;
      EXCEPTION WHEN OTHERS THEN
        v_qr_ok := false;
      END;
    END IF;
  END IF;
  NEW.qr_verified := v_qr_ok;

  -- 6. Risk engine (verbatim from 022).
  IF NEW.photo_path IS NULL THEN
    v_score := v_score + 25;  v_flags := v_flags || ARRAY['missing_photo'];
  END IF;

  IF NEW.signature_path IS NULL THEN
    v_score := v_score + 25;  v_flags := v_flags || ARRAY['missing_signature'];
  END IF;

  IF NOT NEW.geofence_verified THEN
    v_score := v_score + 20;  v_flags := v_flags || ARRAY['geofence_failed'];
  END IF;

  IF NEW.gps_lat IS NOT NULL AND NEW.gps_lng IS NOT NULL
     AND (NEW.gps_accuracy_m IS NULL OR NEW.gps_accuracy_m > 50)
  THEN
    v_score := v_score + 10;  v_flags := v_flags || ARRAY['gps_low_accuracy'];
  END IF;

  IF NEW.qr_code_value IS NOT NULL AND NOT NEW.qr_verified THEN
    v_score := v_score + 10;  v_flags := v_flags || ARRAY['qr_mismatch'];
    IF v_replay THEN
      v_flags := v_flags || ARRAY['qr_token_replayed'];
    END IF;
  END IF;

  IF NEW.qr_verified AND NOT NEW.geofence_verified THEN
    v_score := v_score + 30;  v_flags := v_flags || ARRAY['possible_relay_attack'];
  END IF;

  IF NEW.weight_kg > 5000 THEN
    v_score := v_score + 10;  v_flags := v_flags || ARRAY['weight_anomaly'];
  END IF;

  IF v_driver.license_expiry <= (CURRENT_DATE + INTERVAL '30 days')::date THEN
    v_score := v_score + 15;  v_flags := v_flags || ARRAY['driver_license_expiring'];
  END IF;

  IF v_vehicle_expiry <= (CURRENT_DATE + INTERVAL '30 days')::date THEN
    v_score := v_score + 15;  v_flags := v_flags || ARRAY['vehicle_license_expiring'];
  END IF;

  IF v_score > 100 THEN
    v_score := 100;
  END IF;

  -- 6b. Required-evidence enforcement. 'branch_confirmation' joins the same
  -- v_missing_required machinery as every other item — it is unconditionally
  -- "missing" at insert time (a second party's confirmation cannot exist yet
  -- for a row that doesn't exist yet).
  v_required := public.resolve_required_evidence(NEW.transport_company_id, NEW.waste_types);

  IF 'qr' = ANY(v_required) AND NOT NEW.qr_verified THEN
    v_missing_required := v_missing_required || ARRAY['qr'];
  END IF;
  IF 'geofenced_gps' = ANY(v_required) AND NOT NEW.geofence_verified THEN
    v_missing_required := v_missing_required || ARRAY['geofenced_gps'];
  END IF;
  IF 'photo' = ANY(v_required) AND NEW.photo_path IS NULL THEN
    v_missing_required := v_missing_required || ARRAY['photo'];
  END IF;
  IF 'signature' = ANY(v_required) AND NEW.signature_path IS NULL THEN
    v_missing_required := v_missing_required || ARRAY['signature'];
  END IF;
  IF 'receipt' = ANY(v_required) AND NEW.receipt_path IS NULL THEN
    v_missing_required := v_missing_required || ARRAY['receipt'];
  END IF;
  IF 'scale_photo' = ANY(v_required) AND NEW.scale_photo_path IS NULL THEN
    v_missing_required := v_missing_required || ARRAY['scale_photo'];
  END IF;
  IF 'branch_confirmation' = ANY(v_required) THEN
    v_missing_required := v_missing_required || ARRAY['branch_confirmation'];
  END IF;

  IF array_length(v_missing_required, 1) > 0 THEN
    v_flags := v_flags || ARRAY['missing_required_evidence'];
    FOREACH v_item IN ARRAY v_missing_required LOOP
      v_flags := v_flags || ARRAY['missing_required:' || v_item];
    END LOOP;
  END IF;

  IF NEW.qr_skip_reason IS NOT NULL THEN
    v_flags := v_flags || ARRAY['qr_skipped_with_reason'];
    IF 'qr' = ANY(v_required) THEN
      v_flags := v_flags || ARRAY['reduced_verification'];
    END IF;
  END IF;

  NEW.risk_score := v_score;

  -- Final compliance_status: "other" required items missing (anything but
  -- branch_confirmation) still dominates unconditionally into non_compliant,
  -- unchanged from 022. If branch_confirmation is the ONLY thing missing,
  -- the row is pending_confirmation, not compliant — the whole point of
  -- this migration.
  v_missing_ex_confirm := array_remove(v_missing_required, 'branch_confirmation');

  IF array_length(v_missing_ex_confirm, 1) > 0 THEN
    NEW.compliance_status := 'non_compliant';
  ELSIF 'branch_confirmation' = ANY(v_missing_required) THEN
    NEW.compliance_status := 'pending_confirmation';
    v_flags := v_flags || ARRAY['awaiting_branch_confirmation'];
  ELSIF v_score = 0 THEN
    NEW.compliance_status := 'compliant';
  ELSIF v_score <= 39 THEN
    NEW.compliance_status := 'warning';
  ELSE
    NEW.compliance_status := 'non_compliant';
  END IF;

  NEW.risk_flags := v_flags;

  RETURN NEW;
END;
$$;

-- ─────────────────────────────────────────────────────────────
-- C. recompute_pickup_compliance — the single authority for every
--    transition OUT of pending_confirmation. No-op unless the row is
--    CURRENTLY pending_confirmation (see header). Consumes
--    confirmation_method_policy and confirmation_window_policy HERE, never
--    at read time.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.recompute_pickup_compliance(p_pickup_event_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_event        public.pickup_events%ROWTYPE;
  v_confirmation public.pickup_confirmations%ROWTYPE;
  v_window_hours integer;
  v_sufficient   boolean;
  v_new_status   text;
  v_new_flags    text[];
BEGIN
  SELECT * INTO v_event FROM public.pickup_events WHERE id = p_pickup_event_id;
  IF NOT FOUND OR v_event.compliance_status <> 'pending_confirmation' THEN
    RETURN;
  END IF;

  v_new_flags := v_event.risk_flags;

  SELECT * INTO v_confirmation
  FROM public.pickup_confirmations WHERE pickup_event_id = p_pickup_event_id;

  IF NOT FOUND THEN
    -- No confirmation yet — only actionable if the configured window has
    -- elapsed since the pickup was recorded (item d: "past a configurable
    -- window (default 24h)").
    SELECT COALESCE(
      (SELECT window_hours FROM public.confirmation_window_policy
         WHERE transport_company_id = v_event.transport_company_id),
      (SELECT window_hours FROM public.confirmation_window_policy
         WHERE transport_company_id IS NULL)
    ) INTO v_window_hours;

    IF v_event.created_at >= now() - make_interval(hours => v_window_hours) THEN
      RETURN; -- still within window — nothing to do yet
    END IF;

    v_new_status := 'non_compliant';
    v_new_flags  := array_remove(v_new_flags, 'awaiting_branch_confirmation')
                    || ARRAY['confirmation_window_expired'];

  ELSIF v_confirmation.status = 'disputed' THEN
    v_new_status := 'non_compliant';
    v_new_flags  := array_remove(v_new_flags, 'awaiting_branch_confirmation')
                    || ARRAY['branch_confirmation_disputed'];

  ELSE
    -- status = 'confirmed' — does the METHOD satisfy the requirement?
    SELECT COALESCE(
      (SELECT is_sufficient FROM public.confirmation_method_policy
         WHERE transport_company_id = v_event.transport_company_id AND method = v_confirmation.method),
      (SELECT is_sufficient FROM public.confirmation_method_policy
         WHERE transport_company_id IS NULL AND method = v_confirmation.method),
      false
    ) INTO v_sufficient;

    v_new_flags := array_remove(v_new_flags, 'awaiting_branch_confirmation');

    IF v_sufficient THEN
      -- Requirement satisfied — the ONLY reason this row was pending was
      -- branch_confirmation (see B above), so it's safe to drop both the
      -- generic and specific missing-evidence flags entirely and fall
      -- through to ordinary score-based classification.
      v_new_flags := array_remove(array_remove(v_new_flags,
        'missing_required_evidence'), 'missing_required:branch_confirmation');
      v_new_status := CASE
        WHEN v_event.risk_score = 0  THEN 'compliant'
        WHEN v_event.risk_score <= 39 THEN 'warning'
        ELSE 'non_compliant'
      END;
    ELSE
      -- A confirmation exists but its method doesn't satisfy the
      -- requirement — treated the same as any other unmet required item:
      -- non_compliant. missing_required_evidence / missing_required:
      -- branch_confirmation stay (genuinely still true); reduced_verification
      -- notes that an attempt was made via a weaker channel.
      v_new_status := 'non_compliant';
      v_new_flags  := v_new_flags || ARRAY['reduced_verification'];
    END IF;
  END IF;

  UPDATE public.pickup_events
  SET compliance_status = v_new_status, risk_flags = v_new_flags
  WHERE id = p_pickup_event_id;
END;
$$;

-- Internal-only: called from triggers/the sweep job, never directly by a
-- client — a caller who could invoke this at will could game the timing of
-- their own promotion/demotion. Same posture as is_owner_operationally_blocked
-- (021) and reconcile_trip_weight (018).
REVOKE EXECUTE ON FUNCTION public.recompute_pickup_compliance(uuid) FROM PUBLIC, authenticated, anon;

-- ─────────────────────────────────────────────────────────────
-- pickup_confirmations_after_insert (026) — add the recompute call.
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
  PERFORM public.recompute_pickup_compliance(NEW.pickup_event_id);
  RETURN NEW;
END;
$$;

-- ─────────────────────────────────────────────────────────────
-- D. sweep_expired_pickup_confirmations — the daily job. See migration
--    header: no pg_cron scheduling is wired up here (tracked in
--    PRODUCTION_HARDENING.md instead, same posture as the existing
--    branch_qr_used_tokens entry). Safe to call repeatedly/redundantly —
--    recompute_pickup_compliance() is idempotent and a no-op once a row has
--    left pending_confirmation.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.sweep_expired_pickup_confirmations()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_event_id uuid;
  v_count    integer := 0;
BEGIN
  FOR v_event_id IN
    SELECT id FROM public.pickup_events WHERE compliance_status = 'pending_confirmation'
  LOOP
    PERFORM public.recompute_pickup_compliance(v_event_id);
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.sweep_expired_pickup_confirmations() FROM PUBLIC, authenticated, anon;
-- Explicitly (re-)granted to service_role: unlike recompute_pickup_compliance
-- (only ever called from another trigger), this one is meant to be invoked
-- by an external scheduler hitting a service-role RPC, per the
-- PRODUCTION_HARDENING.md pattern.
GRANT EXECUTE ON FUNCTION public.sweep_expired_pickup_confirmations() TO service_role;

-- ─────────────────────────────────────────────────────────────
-- Item 2 (regions follow-up): a nullable gastat_code column, unpopulated
-- for now, so gov reporting can map to GASTAT's own coding later without
-- re-keying an FK that will already be in use by then. UNIQUE (not NOT
-- NULL) — multiple NULLs are fine, no two POPULATED codes should collide.
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.regions ADD COLUMN gastat_code text UNIQUE;

-- ═══════════════════════════════════════════════════════════════════════════
-- END OF MIGRATION 030
-- ═══════════════════════════════════════════════════════════════════════════
