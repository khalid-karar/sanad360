-- ═══════════════════════════════════════════════════════════════════════════
-- Sanad 360 – Migration 042: CP8 D2 — tenant-wide operational blocking
-- ═══════════════════════════════════════════════════════════════════════════
-- Generalizes is_owner_operationally_blocked() (021) — currently driver/
-- vehicle only — to ALSO cover 'company' and 'transport_company': if a
-- tenant's OWN required documents (commercial_registration + vat_certificate
-- for a company; commercial_registration + ncwm_license for a transport
-- company — the same required_documents rows already seeded in 021) are not
-- ALL verified and current, the whole tenant is blocked from scheduling new
-- work. Driver/vehicle scoping is untouched — a driver's own expired iqama
-- still blocks only that driver, never the whole company.
--
-- INTERPRETATION NOTE (flagging explicitly, not deciding silently): "CR
-- expiry restricts the whole tenant" is read here as "the tenant's own
-- REQUIRED DOCUMENT SET, same completion/verification/expiry rule already
-- applied to drivers/vehicles" — not narrowly CR-only — because that's the
-- existing, consistent meaning of is_owner_operationally_blocked() for every
-- other owner_type (it already delegates to _owner_document_status_unsafe's
-- activation_status, which is "every required doc verified and unexpired",
-- not any single doc_type). If the intent was literally CR-only (ignoring
-- vat_certificate/ncwm_license), that's a different, narrower function and
-- should be said explicitly — this migration implements the consistent
-- generalization.
--
-- CRITICAL COMPAT ISSUE THIS MIGRATION MUST HANDLE: unlike drivers/vehicles,
-- NO company or transport_company in this system has ever been required to
-- upload a commercial_registration document — document tracking for tenants
-- didn't exist before this migration. Enforcing the gate immediately, with
-- no grandfather clause, would instantly operationally freeze EVERY existing
-- tenant (including real pilot companies) the moment this migration lands,
-- since none of them have a verified CR document on file. This migration
-- therefore repeats 021's exact grandfather pattern: a locked
-- compliance_exempt column, backfilled true for every company/
-- transport_company that exists BEFORE this migration, false (enforced) for
-- everything created after.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────
-- A. compliance_exempt columns + one-time backfill (mirrors 021 Part A for
--    drivers/vehicles exactly).
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.companies
  ADD COLUMN compliance_exempt boolean NOT NULL DEFAULT false;
ALTER TABLE public.transport_companies
  ADD COLUMN compliance_exempt boolean NOT NULL DEFAULT false;

UPDATE public.companies           SET compliance_exempt = true;
UPDATE public.transport_companies SET compliance_exempt = true;

-- ─────────────────────────────────────────────────────────────
-- B. Lock compliance_exempt down (mirrors 021 Part B0 exactly — same
--    rationale: without this, an owner/manager could self-grant exemption
--    on a brand-new tenant, or flip an existing enforced tenant back to
--    exempt via a normal UPDATE).
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.companies_lock_compliance_exempt()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.compliance_exempt := false;
  ELSE
    NEW.compliance_exempt := OLD.compliance_exempt;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER companies_lock_compliance_exempt_trigger
  BEFORE INSERT OR UPDATE ON public.companies
  FOR EACH ROW EXECUTE FUNCTION public.companies_lock_compliance_exempt();

CREATE OR REPLACE FUNCTION public.transport_companies_lock_compliance_exempt()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.compliance_exempt := false;
  ELSE
    NEW.compliance_exempt := OLD.compliance_exempt;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER transport_companies_lock_compliance_exempt_trigger
  BEFORE INSERT OR UPDATE ON public.transport_companies
  FOR EACH ROW EXECUTE FUNCTION public.transport_companies_lock_compliance_exempt();

-- Note: review_pending_application() (035) INSERTs the new companies/
-- transport_companies row directly (not via the app's normal onboarding
-- path) — that INSERT goes through this same trigger like any other, so a
-- freshly-approved tenant is correctly NOT exempt (compliance_exempt=false),
-- consistent with "enforced from day one for anything created after this
-- migration" — no special-casing needed there.

-- ─────────────────────────────────────────────────────────────
-- C. is_owner_operationally_blocked() — DIFF vs 021: two new ELSIF branches
--    added before the existing ELSE; everything else (the exemption check,
--    the activation_status lookup, the final RETURN) is byte-for-byte
--    unchanged.
-- ─────────────────────────────────────────────────────────────
--
-- --- diff ---
--    IF p_owner_type = 'driver' THEN
--      SELECT compliance_exempt INTO v_exempt FROM public.drivers WHERE id = p_owner_id;
--    ELSIF p_owner_type = 'vehicle' THEN
--      SELECT compliance_exempt INTO v_exempt FROM public.vehicles WHERE id = p_owner_id;
-- +  ELSIF p_owner_type = 'company' THEN
-- +    SELECT compliance_exempt INTO v_exempt FROM public.companies WHERE id = p_owner_id;
-- +  ELSIF p_owner_type = 'transport_company' THEN
-- +    SELECT compliance_exempt INTO v_exempt FROM public.transport_companies WHERE id = p_owner_id;
--    ELSE
--      RETURN false;
--    END IF;
-- --- end diff ---
--
CREATE OR REPLACE FUNCTION public.is_owner_operationally_blocked(p_owner_type text, p_owner_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_exempt boolean;
  v_status text;
BEGIN
  IF p_owner_type = 'driver' THEN
    SELECT compliance_exempt INTO v_exempt FROM public.drivers WHERE id = p_owner_id;
  ELSIF p_owner_type = 'vehicle' THEN
    SELECT compliance_exempt INTO v_exempt FROM public.vehicles WHERE id = p_owner_id;
  ELSIF p_owner_type = 'company' THEN
    SELECT compliance_exempt INTO v_exempt FROM public.companies WHERE id = p_owner_id;
  ELSIF p_owner_type = 'transport_company' THEN
    SELECT compliance_exempt INTO v_exempt FROM public.transport_companies WHERE id = p_owner_id;
  ELSE
    RETURN false;
  END IF;

  -- Row not found is handled by the caller's own FK-consistency checks
  -- (unchanged comment from 021 — still true: every caller below already
  -- validates the owner exists before reaching this function).
  IF v_exempt IS NULL OR v_exempt THEN
    RETURN false;
  END IF;

  SELECT activation_status INTO v_status
  FROM public._owner_document_status_unsafe(p_owner_type, p_owner_id);
  RETURN v_status IS DISTINCT FROM 'active';
END;
$$;

-- ─────────────────────────────────────────────────────────────
-- D. pickup_assignments_document_gate() — DIFF vs 021: one new company-level
--    check, plus a DERIVED transport_company-level check. pickup_assignments
--    has no transport_company_id column at all (only company_id, driver_id,
--    vehicle_id, branch_id — confirmed via \d) — unlike trips/pickup_events,
--    there is no NEW.transport_company_id to pass directly. Resolved via
--    driver_id (NOT NULL here; drivers.transport_company_id is NOT NULL),
--    mirroring trips_before_insert()'s own driver-lookup pattern exactly
--    (same SELECT shape, same variable name). Without this, a transport_
--    company with incomplete/expired tenant-level docs could still have a
--    pickup_assignment scheduled for one of its (individually-compliant)
--    drivers/vehicles — not a security bypass end-to-end (the driver's
--    actual pickup_events insert would still be blocked by Part F's 4d),
--    but a confusing "scheduling silently succeeds, execution silently
--    fails later" UX gap, and inconsistent with trips blocking immediately
--    at creation. Driver/vehicle checks are otherwise byte-for-byte
--    unchanged.
-- ─────────────────────────────────────────────────────────────
--
-- --- diff ---
--    CREATE OR REPLACE FUNCTION public.pickup_assignments_document_gate()
--    RETURNS trigger
--    LANGUAGE plpgsql
--    SECURITY DEFINER
--    SET search_path = ''
-- +  AS $$
-- +  DECLARE
-- +    v_driver_tc uuid;
--    BEGIN
--      IF public.is_owner_operationally_blocked('company', NEW.company_id) THEN
--        RAISE EXCEPTION 'COMPANY_NOT_ACTIVE: ...' USING ERRCODE = 'P0026';
--      END IF;
-- +
-- +    SELECT transport_company_id INTO v_driver_tc FROM public.drivers WHERE id = NEW.driver_id;
-- +    IF public.is_owner_operationally_blocked('transport_company', v_driver_tc) THEN
-- +      RAISE EXCEPTION 'TRANSPORT_COMPANY_NOT_ACTIVE: transport_company % does not have complete, current, verified required documents and cannot schedule pickups', v_driver_tc
-- +        USING ERRCODE = 'P0027';
-- +    END IF;
-- +
--      IF public.is_owner_operationally_blocked('driver', NEW.driver_id) THEN
--        RAISE EXCEPTION 'DRIVER_NOT_ACTIVE: ...' USING ERRCODE = 'P0023';
--      END IF;
--      IF public.is_owner_operationally_blocked('vehicle', NEW.vehicle_id) THEN
--        RAISE EXCEPTION 'VEHICLE_NOT_ACTIVE: ...' USING ERRCODE = 'P0024';
--      END IF;
--      RETURN NEW;
--    END;
--    $$;
-- --- end diff ---
--
CREATE OR REPLACE FUNCTION public.pickup_assignments_document_gate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_driver_tc uuid;
BEGIN
  IF public.is_owner_operationally_blocked('company', NEW.company_id) THEN
    RAISE EXCEPTION 'COMPANY_NOT_ACTIVE: company % does not have complete, current, verified required documents and cannot schedule pickups', NEW.company_id
      USING ERRCODE = 'P0026';
  END IF;

  SELECT transport_company_id INTO v_driver_tc FROM public.drivers WHERE id = NEW.driver_id;
  IF public.is_owner_operationally_blocked('transport_company', v_driver_tc) THEN
    RAISE EXCEPTION 'TRANSPORT_COMPANY_NOT_ACTIVE: transport_company % does not have complete, current, verified required documents and cannot schedule pickups', v_driver_tc
      USING ERRCODE = 'P0027';
  END IF;

  IF public.is_owner_operationally_blocked('driver', NEW.driver_id) THEN
    RAISE EXCEPTION 'DRIVER_NOT_ACTIVE: driver % does not have complete, current, verified required documents and cannot be scheduled', NEW.driver_id
      USING ERRCODE = 'P0023';
  END IF;
  IF public.is_owner_operationally_blocked('vehicle', NEW.vehicle_id) THEN
    RAISE EXCEPTION 'VEHICLE_NOT_ACTIVE: vehicle % does not have complete, current, verified required documents and cannot be scheduled', NEW.vehicle_id
      USING ERRCODE = 'P0024';
  END IF;
  RETURN NEW;
END;
$$;

-- ─────────────────────────────────────────────────────────────
-- E. trips_before_insert() — DIFF vs 018: one new transport_company-level
--    check added as the FIRST check (a blocked tenant shouldn't get as far
--    as driver/vehicle FK validation); every other line byte-for-byte
--    unchanged.
-- ─────────────────────────────────────────────────────────────
--
-- --- diff ---
--    BEGIN
--      IF auth.uid() IS NOT NULL THEN
--        NEW.created_by := auth.uid();
--      END IF;
--
-- +    IF public.is_owner_operationally_blocked('transport_company', NEW.transport_company_id) THEN
-- +      RAISE EXCEPTION 'TRANSPORT_COMPANY_NOT_ACTIVE: transport_company % does not have complete, current, verified required documents and cannot create trips', NEW.transport_company_id
-- +        USING ERRCODE = 'P0027';
-- +    END IF;
-- +
--      SELECT transport_company_id INTO v_driver_tc FROM public.drivers WHERE id = NEW.driver_id;
--      ... (unchanged)
-- --- end diff ---
--
CREATE OR REPLACE FUNCTION public.trips_before_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_driver_tc  uuid;
  v_vehicle_tc uuid;
BEGIN
  IF auth.uid() IS NOT NULL THEN
    NEW.created_by := auth.uid();
  END IF;

  IF public.is_owner_operationally_blocked('transport_company', NEW.transport_company_id) THEN
    RAISE EXCEPTION 'TRANSPORT_COMPANY_NOT_ACTIVE: transport_company % does not have complete, current, verified required documents and cannot create trips', NEW.transport_company_id
      USING ERRCODE = 'P0027';
  END IF;

  SELECT transport_company_id INTO v_driver_tc FROM public.drivers WHERE id = NEW.driver_id;
  IF v_driver_tc IS NULL OR v_driver_tc <> NEW.transport_company_id THEN
    RAISE EXCEPTION 'DRIVER_TRANSPORT_MISMATCH: driver_id % does not belong to transport_company_id %',
      NEW.driver_id, NEW.transport_company_id USING ERRCODE = 'P0004';
  END IF;

  SELECT transport_company_id INTO v_vehicle_tc FROM public.vehicles WHERE id = NEW.vehicle_id;
  IF v_vehicle_tc IS NULL OR v_vehicle_tc <> NEW.transport_company_id THEN
    RAISE EXCEPTION 'VEHICLE_TRANSPORT_MISMATCH: vehicle_id % does not belong to transport_company_id %',
      NEW.vehicle_id, NEW.transport_company_id USING ERRCODE = 'P0005';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.facility_transporters ft
    WHERE ft.facility_id = NEW.planned_facility_id
      AND ft.transport_company_id = NEW.transport_company_id
      AND ft.status = 'active'
  ) THEN
    RAISE EXCEPTION 'FACILITY_NOT_LINKED: facility % is not actively linked to transport_company %',
      NEW.planned_facility_id, NEW.transport_company_id USING ERRCODE = 'P0008';
  END IF;

  -- New trips always start in the planning state, regardless of client input.
  NEW.status                       := 'planned';
  NEW.weight_reconciliation_status := 'pending';
  NEW.reconciled_net_weight_kg     := NULL;
  NEW.reconciled_pickup_weight_kg  := NULL;

  RETURN NEW;
END;
$$;

-- trips_before_insert_trigger (018) already points at this function by
-- name — CREATE OR REPLACE is sufficient, no DROP/CREATE TRIGGER needed.

-- ─────────────────────────────────────────────────────────────
-- F. pickup_events_before_insert() — CLOSES A REAL BYPASS. pickup_events has
--    NO FK to pickup_assignments at all, and trip_id (018) is OPTIONAL — a
--    driver or owner/manager/dispatcher can INSERT a pickup_event directly
--    (pickup_events_insert_driver / pickup_events_insert_manager, 001),
--    with no pickup_assignments row and no trip_id, hitting neither of the
--    two gates added in Parts D/E above. This function's own step 4c
--    already independently re-checks driver/vehicle blocking here for
--    exactly this reason (it doesn't trust the assignment-time gate alone
--    to be the only enforcement point) — company/transport_company need
--    the same independent re-check, not just the assignment/trip-time gate.
--
--    CORRECTED BASE: an earlier draft of this migration built this diff
--    against migration 021's version of this function — but 022 (QR HMAC
--    verification + required-evidence enforcement) and 030 (pending_
--    confirmation compliance) BOTH replaced this same function again after
--    021. Rebuilding from 021 would have silently reverted every bit of
--    that intermediate logic. The base below is 030's version verbatim
--    (the current, latest one) — confirmed by grep across every migration
--    that touches this function name.
--
--    DIFF vs 030: one new block (4d) inserted immediately after the
--    existing step 4c, before step 5 (geofence); every other line —
--    branch/driver/vehicle/trip FK checks, QR HMAC verification, risk
--    engine, required-evidence enforcement, the final compliance_status
--    decision — is byte-for-byte unchanged. Reuses the SAME error codes as
--    Parts D/E (P0026/P0027), matching this function's own existing
--    convention of reusing P0023/P0024 for the same logical driver/
--    vehicle-blocked error at multiple enforcement points, not minting a
--    new code per call site.
-- ─────────────────────────────────────────────────────────────
--
-- --- diff (vs 030) ---
--    -- 4c. (021) A non-exempt driver/vehicle that isn't ACTIVE (onboarding OR
--    -- restricted) may not complete a pickup — mirrors the pickup_assignments gate.
--    IF public.is_owner_operationally_blocked('driver', NEW.driver_id) THEN
--      RAISE EXCEPTION 'DRIVER_NOT_ACTIVE: ...' USING ERRCODE = 'P0023';
--    END IF;
--    IF public.is_owner_operationally_blocked('vehicle', NEW.vehicle_id) THEN
--      RAISE EXCEPTION 'VEHICLE_NOT_ACTIVE: ...' USING ERRCODE = 'P0024';
--    END IF;
-- +
-- +  -- 4d. (042) Same tenant-level re-check as 4c — see Part F header.
-- +  IF public.is_owner_operationally_blocked('company', NEW.company_id) THEN
-- +    RAISE EXCEPTION 'COMPANY_NOT_ACTIVE: company % does not have complete, current, verified required documents and cannot complete a pickup', NEW.company_id
-- +      USING ERRCODE = 'P0026';
-- +  END IF;
-- +  IF public.is_owner_operationally_blocked('transport_company', NEW.transport_company_id) THEN
-- +    RAISE EXCEPTION 'TRANSPORT_COMPANY_NOT_ACTIVE: transport_company % does not have complete, current, verified required documents and cannot complete a pickup', NEW.transport_company_id
-- +      USING ERRCODE = 'P0027';
-- +  END IF;
--
--    -- 5. Geofence: distance AND credible accuracy (fail closed).
--    ... (unchanged — QR HMAC verification, risk engine, required-evidence
--    enforcement, and the final compliance_status decision all follow,
--    all unchanged from 030)
-- --- end diff ---
--
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

  -- 4d. (042) Same tenant-level re-check as 4c — see Part F header above.
  IF public.is_owner_operationally_blocked('company', NEW.company_id) THEN
    RAISE EXCEPTION 'COMPANY_NOT_ACTIVE: company % does not have complete, current, verified required documents and cannot complete a pickup', NEW.company_id
      USING ERRCODE = 'P0026';
  END IF;
  IF public.is_owner_operationally_blocked('transport_company', NEW.transport_company_id) THEN
    RAISE EXCEPTION 'TRANSPORT_COMPANY_NOT_ACTIVE: transport_company % does not have complete, current, verified required documents and cannot complete a pickup', NEW.transport_company_id
      USING ERRCODE = 'P0027';
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
  -- (branches.qr_token, never displayed to any client), check branch match
  -- + TTL, then consume the token exactly once via branch_qr_used_tokens —
  -- replay fails closed.
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

  -- 6. Risk engine (verbatim from 022/030).
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
  -- the row is pending_confirmation, not compliant.
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

-- pickup_events_before_insert_trigger (013/018) already points at this
-- function by name — CREATE OR REPLACE is sufficient, no DROP/CREATE
-- TRIGGER needed.

-- ═══════════════════════════════════════════════════════════════════════════
-- END OF MIGRATION 042
-- ═══════════════════════════════════════════════════════════════════════════
