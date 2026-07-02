-- ═══════════════════════════════════════════════════════════════════════════
-- Sanad 360 – Migration 013: Evidence hardening + assignment least-privilege
-- ═══════════════════════════════════════════════════════════════════════════
-- Closes the remaining "client-attested" gaps in the verification story:
--
-- 1) QR IS NOW VERIFIED, NOT DECORATIVE. branches gets a secret qr_token
--    (printed on the facility QR board); the trigger compares the scanned
--    value and stamps pickup_events.qr_verified server-side. A wrong scan
--    adds the qr_mismatch risk flag (+10).
--
-- 2) GEOFENCE REQUIRES CREDIBLE GPS. geofence_verified now also requires a
--    reported accuracy no larger than the branch radius — a 2 km-accuracy fix
--    "inside" a 150 m fence proves nothing. GPS with missing/poor accuracy
--    (> 50 m) adds gps_low_accuracy (+10).
--
-- 3) WEIGHT PLAUSIBILITY. weight_kg > 5000 flags weight_anomaly (+10) —
--    fat-fingered 4200 kg entries surface for review instead of silently
--    entering the compliance record.
--
-- 4) ASSIGNMENT LEAST-PRIVILEGE. 003's transport arm let ANY member of a
--    transport company (including every driver) read and update EVERY
--    assignment in the company — driver A could cancel driver B's job.
--    Drivers are now scoped to assignments whose driver record links to
--    their own profile; TC-wide visibility/updates stay with transport
--    owner/manager/dispatcher (the 011 staff policies).
-- ═══════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────
-- 1a. Schema: branch QR secret + server-computed verification flag
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.branches
  ADD COLUMN IF NOT EXISTS qr_token uuid NOT NULL DEFAULT gen_random_uuid();

ALTER TABLE public.pickup_events
  ADD COLUMN IF NOT EXISTS qr_verified boolean NOT NULL DEFAULT false;

-- SELECT * views freeze their column list — recreate to expose qr_verified.
CREATE OR REPLACE VIEW public.pickup_events_latest
  WITH (security_invoker = true) AS
SELECT DISTINCT ON (logical_id) *
FROM public.pickup_events
ORDER BY logical_id, revision DESC;

-- ─────────────────────────────────────────────────────────────
-- 1b. Risk engine v3 (replaces 002's function in place)
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

  -- 5b. QR verification against the branch secret (server-side, not spoofable).
  NEW.qr_verified :=
    NEW.qr_code_value IS NOT NULL
    AND NEW.qr_code_value = v_branch.qr_token::text;

  -- 6. Risk engine.
  IF NEW.photo_path IS NULL THEN
    v_score := v_score + 25;  v_flags := v_flags || ARRAY['missing_photo'];
  END IF;

  IF NEW.signature_path IS NULL THEN
    v_score := v_score + 25;  v_flags := v_flags || ARRAY['missing_signature'];
  END IF;

  IF NOT NEW.geofence_verified THEN
    v_score := v_score + 20;  v_flags := v_flags || ARRAY['geofence_failed'];
  END IF;

  -- GPS present but with missing or poor (> 50 m) accuracy.
  IF NEW.gps_lat IS NOT NULL AND NEW.gps_lng IS NOT NULL
     AND (NEW.gps_accuracy_m IS NULL OR NEW.gps_accuracy_m > 50)
  THEN
    v_score := v_score + 10;  v_flags := v_flags || ARRAY['gps_low_accuracy'];
  END IF;

  -- QR scanned but does not match this branch's token.
  IF NEW.qr_code_value IS NOT NULL AND NOT NEW.qr_verified THEN
    v_score := v_score + 10;  v_flags := v_flags || ARRAY['qr_mismatch'];
  END IF;

  -- Implausible single-pickup weight.
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

-- ─────────────────────────────────────────────────────────────
-- 4. Assignment least-privilege (replaces 003's SELECT/UPDATE)
--    Transport staff (owner/manager/dispatcher) keep TC-wide access; a
--    role='driver' member is scoped to their OWN linked driver record.
--    (011's *_transport INSERT/UPDATE staff policies remain in force.)
-- ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS pickup_assignments_select ON public.pickup_assignments;
CREATE POLICY pickup_assignments_select ON public.pickup_assignments
  FOR SELECT TO authenticated
  USING (
    company_id = (public.my_membership()).company_id
    OR (public.my_membership()).role = 'admin'
    -- driver: only assignments pointing at THEIR driver record
    OR EXISTS (
      SELECT 1 FROM public.drivers d
      WHERE d.id = pickup_assignments.driver_id
        AND d.profile_id = auth.uid()
    )
    -- transport staff: whole fleet
    OR (
      (public.my_membership()).role IN ('owner','manager','dispatcher')
      AND (public.my_membership()).transport_company_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM public.drivers d
        WHERE d.id = pickup_assignments.driver_id
          AND d.transport_company_id = (public.my_membership()).transport_company_id
      )
    )
  );

DROP POLICY IF EXISTS pickup_assignments_update ON public.pickup_assignments;
CREATE POLICY pickup_assignments_update ON public.pickup_assignments
  FOR UPDATE TO authenticated
  USING (
    (
      company_id = (public.my_membership()).company_id
      AND (public.my_membership()).role IN ('owner','manager','dispatcher')
    )
    -- driver: may act only on their own assignments
    OR EXISTS (
      SELECT 1 FROM public.drivers d
      WHERE d.id = pickup_assignments.driver_id
        AND d.profile_id = auth.uid()
    )
  );

-- ═══════════════════════════════════════════════════════════════════════════
-- END OF MIGRATION 013
-- ═══════════════════════════════════════════════════════════════════════════
