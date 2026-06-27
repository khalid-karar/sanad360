-- ═══════════════════════════════════════════════════════════════════════════
-- Tadweer360 – Phase 2 Migration: Risk Score Engine
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Replaces pickup_events_before_insert() in-place (CREATE OR REPLACE).
-- The existing trigger binding (pickup_events_before_insert_trigger) does
-- NOT need to be dropped; the new function body takes effect automatically.
--
-- What changes in this migration vs 001:
--   • v_driver_tc_id uuid  → v_driver drivers%ROWTYPE  (to read license_expiry)
--   • Fetches vehicle ncwm_license_expiry alongside transport_company_id
--   • Adds risk-score engine as section 6 of the trigger body
--
-- Risk rules (applied after geofence_verified is computed in section 5):
--
--   Flag                     Points  Condition
--   ─────────────────────────────────────────────────────────────────────
--   missing_photo              +25   photo_path IS NULL
--   missing_signature          +25   signature_path IS NULL
--   geofence_failed            +20   geofence_verified = false (just computed)
--   driver_license_expiring    +15   driver.license_expiry ≤ today + 30 days
--   vehicle_license_expiring   +15   vehicle.ncwm_license_expiry ≤ today + 30 days
--
-- Score is capped at 100.
-- compliance_status:  0 → compliant | 1-39 → warning | 40+ → non_compliant
--
-- risk_score / risk_flags / compliance_status are OVERWRITTEN by the trigger
-- regardless of what the client sent.
--
-- No new tables, no new privilege grants, no schema additions needed.
-- inspection_pdfs and its RLS were created in 001.
-- ═══════════════════════════════════════════════════════════════════════════

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
  -- risk engine accumulators
  v_score               integer := 0;
  v_flags               text[]  := '{}';
BEGIN

  -- ── 1. Enforce created_by = caller (not spoofable by authenticated clients).
  --      When auth.uid() is NULL (service_role / backend insert), leave
  --      created_by as whatever the caller supplied (or NULL) — that is fine
  --      because service_role bypasses RLS entirely.
  IF auth.uid() IS NOT NULL THEN
    NEW.created_by := auth.uid();
  END IF;

  -- ── 2. Validate branch belongs to company ───────────────────────────────
  SELECT * INTO v_branch
  FROM public.branches
  WHERE id = NEW.branch_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'BRANCH_NOT_FOUND: branch_id % does not exist', NEW.branch_id
      USING ERRCODE = 'P0002';
  END IF;

  IF v_branch.company_id <> NEW.company_id THEN
    RAISE EXCEPTION 'BRANCH_COMPANY_MISMATCH: branch_id % does not belong to company_id %',
      NEW.branch_id, NEW.company_id
      USING ERRCODE = 'P0003';
  END IF;

  -- ── 3. Validate driver belongs to transport_company ─────────────────────
  --      Fetch full row (need license_expiry for risk engine in section 6)
  SELECT * INTO v_driver
  FROM public.drivers
  WHERE id = NEW.driver_id;

  IF NOT FOUND OR v_driver.transport_company_id <> NEW.transport_company_id THEN
    RAISE EXCEPTION 'DRIVER_TRANSPORT_MISMATCH: driver_id % does not belong to transport_company_id %',
      NEW.driver_id, NEW.transport_company_id
      USING ERRCODE = 'P0004';
  END IF;

  -- ── 4. Validate vehicle belongs to transport_company ────────────────────
  --      Fetch ncwm_license_expiry for risk engine in section 6
  SELECT transport_company_id, ncwm_license_expiry
    INTO v_vehicle_tc_id, v_vehicle_expiry
  FROM public.vehicles
  WHERE id = NEW.vehicle_id;

  IF NOT FOUND OR v_vehicle_tc_id <> NEW.transport_company_id THEN
    RAISE EXCEPTION 'VEHICLE_TRANSPORT_MISMATCH: vehicle_id % does not belong to transport_company_id %',
      NEW.vehicle_id, NEW.transport_company_id
      USING ERRCODE = 'P0005';
  END IF;

  -- ── 5. Compute geofence_verified via plpgsql haversine ──────────────────
  --      null GPS or null branch coords → fail closed (false), not an error
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
    v_dist_m := 2 * 6371000 * asin(sqrt(v_a));   -- Earth radius in metres
    NEW.geofence_verified := (v_dist_m <= v_branch.geofence_radius_m::double precision);
  END IF;

  -- ── 6. Risk Score Engine (runs after geofence so we can read NEW.geofence_verified) ──

  -- missing_photo (+25)
  IF NEW.photo_path IS NULL THEN
    v_score := v_score + 25;
    v_flags := v_flags || ARRAY['missing_photo'];
  END IF;

  -- missing_signature (+25)
  IF NEW.signature_path IS NULL THEN
    v_score := v_score + 25;
    v_flags := v_flags || ARRAY['missing_signature'];
  END IF;

  -- geofence_failed (+20) — uses value computed in section 5 above
  IF NOT NEW.geofence_verified THEN
    v_score := v_score + 20;
    v_flags := v_flags || ARRAY['geofence_failed'];
  END IF;

  -- driver_license_expiring (+15)
  -- Fires when the license is already expired OR will expire within 30 days.
  IF v_driver.license_expiry <= (CURRENT_DATE + INTERVAL '30 days')::date THEN
    v_score := v_score + 15;
    v_flags := v_flags || ARRAY['driver_license_expiring'];
  END IF;

  -- vehicle_license_expiring (+15)
  IF v_vehicle_expiry <= (CURRENT_DATE + INTERVAL '30 days')::date THEN
    v_score := v_score + 15;
    v_flags := v_flags || ARRAY['vehicle_license_expiring'];
  END IF;

  -- Cap at 100
  IF v_score > 100 THEN
    v_score := 100;
  END IF;

  -- Write risk fields — overwrite whatever the client sent
  NEW.risk_score        := v_score;
  NEW.risk_flags        := v_flags;
  NEW.compliance_status :=
    CASE
      WHEN v_score = 0    THEN 'compliant'
      WHEN v_score <= 39  THEN 'warning'
      ELSE                     'non_compliant'
    END;

  RETURN NEW;
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- END OF MIGRATION 002
--
-- To apply:
--   supabase migration up          -- incremental (if 001 already applied)
--   supabase db reset              -- full reset (re-runs 001 + seed + 002)
--
-- To verify the risk engine:
--   INSERT INTO pickup_events (..., photo_path = NULL, signature_path = NULL, ...);
--   SELECT risk_score, risk_flags, compliance_status FROM pickup_events WHERE ...;
-- ═══════════════════════════════════════════════════════════════════════════
