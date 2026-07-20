-- ═══════════════════════════════════════════════════════════════════════════
-- Sanad 360 – Migration 018: CP1 — Recycler facilities, trips, weight
--                            reconciliation (closes the 3-party custody chain)
-- ═══════════════════════════════════════════════════════════════════════════
-- The ledger proves curb pickup (pickup_events) and, since 010, that SOME
-- disposal happened — but disposal_confirmations was free-text facility
-- identity, written by the TRANSPORTER's own driver. Nothing independently
-- verified from the recycler's side, and nothing tied multiple curb pickups
-- into the single haul (trip/consignment) a truck actually delivers.
--
-- This migration:
--   1. Makes the recycling facility a first-class tenant (facilities +
--      memberships.facility_id), on par with companies/transport_companies.
--   2. Adds facility_transporters, mirroring company_transporters, gating
--      which transporters may plan a trip into which facility.
--   3. Adds trips (consignment/haul), a MUTABLE, audit-logged planning
--      entity linking transport_company/driver/vehicle -> planned facility.
--      pickup_events gets an optional trip_id to group curb pickups into
--      a haul.
--   4. Reworks disposal_confirmations into the recycler's OWN, independent,
--      append-only confirmation of a trip's drop-off: confirmed_by must be a
--      scale_operator OF THE RECEIVING FACILITY; facility_id is force-copied
--      from the trip (never client-writable), so a scale_operator cannot
--      redirect a confirmation to their own facility if the trip was not
--      planned for it, and a transporter cannot self-confirm.
--   5. Adds per-waste-stream weight tolerance config + a reconciliation
--      function that compares Sigma(pickup_events.weight_kg) for the trip
--      against the confirmed net weight and flags (never hard-blocks)
--      mismatches beyond tolerance.
--   6. custody-complete = EXISTS a status='confirmed' disposal_confirmations
--      row for the trip (is_trip_custody_complete()).
--
-- SCOPE v1: one trip -> one dropoff (disposal_confirmations.trip_id is
-- UNIQUE), single waste_stream per trip. Multi-dropoff / mixed-stream is
-- explicitly deferred.
--
-- Requires 017 (recycler_manager / scale_operator enum values) to have run
-- in a prior, separate transaction.
--
-- FILE STRUCTURE (fixes a table-ordering bug: facilities_select originally
-- referenced facility_transporters before that table existed):
--   PART A — schema only: every CREATE TABLE / ALTER TABLE ADD COLUMN /
--            index / constraint, in dependency order, so every table this
--            migration creates or alters exists before anything below
--            references it.
--   PART B — everything that can reference those tables: RLS enable,
--            policies, functions, triggers, grants.
-- ═══════════════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════════════
-- PART A — SCHEMA (tables, columns, indexes, constraints only)
-- ═══════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────
-- A1. FACILITIES  (recycling plants — new tenant type)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE public.facilities (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name_ar           text        NOT NULL,
  name_en           text,
  license_number    text,
  license_expiry    date,
  city              text,
  geofence_lat      numeric(10,7),
  geofence_lng      numeric(10,7),
  geofence_radius_m integer     NOT NULL DEFAULT 150,
  status            text        NOT NULL DEFAULT 'active'
                                CHECK (status IN ('active','inactive')),
  created_at        timestamptz NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────────────────────────
-- A2. memberships: facility as a third tenant type
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.memberships
  ADD COLUMN facility_id uuid REFERENCES public.facilities(id);

CREATE INDEX memberships_facility_id_idx ON public.memberships(facility_id);

ALTER TABLE public.memberships DROP CONSTRAINT one_tenant;
-- NOTE (CP5 forward-compat): the all-null branch below is scoped to
-- role='admin' only. CP5 adds Maya-side platform roles (super_admin,
-- system_admin, support_agent, document_reviewer, billing_accountant) that
-- are ALSO tenant-less (no company/transport_company/facility). When CP5
-- lands, this CHECK must widen to
--   OR (role IN ('admin','super_admin','system_admin','support_agent',
--                'document_reviewer','billing_accountant')
--       AND company_id IS NULL AND transport_company_id IS NULL AND facility_id IS NULL)
-- (which in turn requires those values to already exist on member_role, per
-- the same add-enum-value-in-its-own-migration rule as 017).
ALTER TABLE public.memberships ADD CONSTRAINT one_tenant CHECK (
  num_nonnulls(company_id, transport_company_id, facility_id) = 1
  OR (role = 'admin' AND company_id IS NULL AND transport_company_id IS NULL AND facility_id IS NULL)
);

-- ─────────────────────────────────────────────────────────────
-- A3. FACILITY_TRANSPORTERS  (link-gated, mirrors company_transporters)
--     The FACILITY side controls the link (symmetric to how the COMPANY
--     side controls company_transporters).
-- ─────────────────────────────────────────────────────────────
CREATE TABLE public.facility_transporters (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id           uuid        NOT NULL REFERENCES public.facilities(id),
  transport_company_id  uuid        NOT NULL REFERENCES public.transport_companies(id),
  status                text        NOT NULL DEFAULT 'active'
                                    CHECK (status IN ('active','inactive')),
  created_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (facility_id, transport_company_id)
);

CREATE INDEX facility_transporters_facility_idx ON public.facility_transporters(facility_id);
CREATE INDEX facility_transporters_tc_idx       ON public.facility_transporters(transport_company_id);

-- ─────────────────────────────────────────────────────────────
-- A4. TRIPS  (consignment/haul — MUTABLE planning data, audit-logged)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE public.trips (
  id                            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  transport_company_id         uuid        NOT NULL REFERENCES public.transport_companies(id),
  driver_id                    uuid        NOT NULL REFERENCES public.drivers(id),
  vehicle_id                   uuid        NOT NULL REFERENCES public.vehicles(id),
  planned_facility_id          uuid        NOT NULL REFERENCES public.facilities(id),
  waste_stream                 text        NOT NULL,
  trip_date                    date        NOT NULL DEFAULT CURRENT_DATE,
  status                       text        NOT NULL DEFAULT 'planned'
                                           CHECK (status IN ('planned','in_progress','dropped_off','reconciled','cancelled')),
  -- Server-computed by reconcile_trip_weight() only — see trips_before_update trigger.
  weight_reconciliation_status text        NOT NULL DEFAULT 'pending'
                                           CHECK (weight_reconciliation_status IN ('pending','within_tolerance','flagged')),
  reconciled_net_weight_kg     numeric(10,2),
  reconciled_pickup_weight_kg  numeric(10,2),
  created_by                   uuid        REFERENCES public.profiles(id),
  created_at                   timestamptz NOT NULL DEFAULT now(),
  updated_at                   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX trips_transport_company_idx ON public.trips(transport_company_id, trip_date DESC);
CREATE INDEX trips_planned_facility_idx  ON public.trips(planned_facility_id, trip_date DESC);
CREATE INDEX trips_driver_idx            ON public.trips(driver_id);
CREATE INDEX trips_status_idx            ON public.trips(status);

-- pickup_events: optional link grouping curb pickups into a haul.
ALTER TABLE public.pickup_events
  ADD COLUMN trip_id uuid REFERENCES public.trips(id);

CREATE INDEX pickup_events_trip_id_idx ON public.pickup_events(trip_id);

-- SELECT * views freeze their column list — recreate to expose trip_id.
CREATE OR REPLACE VIEW public.pickup_events_latest
  WITH (security_invoker = true) AS
SELECT DISTINCT ON (logical_id) *
FROM public.pickup_events
ORDER BY logical_id, revision DESC;

-- ─────────────────────────────────────────────────────────────
-- A5. WASTE STREAM TOLERANCES  (per-stream reconciliation config; NOT a flat
--     hardcoded percentage — reconcile_trip_weight() falls back to 2% only
--     when no row matches the trip's waste_stream)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE public.waste_stream_tolerances (
  waste_stream  text        PRIMARY KEY,
  tolerance_pct numeric(5,2) NOT NULL DEFAULT 2.00 CHECK (tolerance_pct > 0),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- Seed realistic per-stream tolerances, aligned to the app's WasteType
-- domain (src/lib/database.types.ts) so trips.waste_stream values match
-- what pickup_events.waste_types already uses. Dry/inert streams lose
-- almost nothing in transit; organic (and other moisture-bearing) streams
-- lose weight to drainage/evaporation between the curb scale and the
-- weighbridge, so they need a wider band. Anything not listed here falls
-- back to the 2% default in reconcile_trip_weight().
INSERT INTO public.waste_stream_tolerances (waste_stream, tolerance_pct) VALUES
  ('plastic',    2.50),
  ('industrial', 3.00),
  ('electronic', 2.00),
  ('medical',    2.50),
  ('chemical',   7.00),  -- liquid/solvent fraction evaporates or settles in transit
  ('organic',    6.00)   -- moisture loss between curb weighing and weighbridge
ON CONFLICT (waste_stream) DO NOTHING;

-- ─────────────────────────────────────────────────────────────
-- A6. DISPOSAL_CONFIRMATIONS REWORK (schema only)
--     From: transporter-attested, free-text facility, one row per pickup_event.
--     To:   recycler-attested (scale_operator of the receiving facility only),
--           FK'd facility, one row per trip (v1: one trip -> one dropoff).
--     The table itself already exists (migration 010); drop its old
--     triggers/policies/indexes before altering columns, same transaction.
-- ─────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS disposal_confirmations_before_insert_trigger ON public.disposal_confirmations;
DROP TRIGGER IF EXISTS disposal_confirmations_after_insert_trigger  ON public.disposal_confirmations;
DROP POLICY  IF EXISTS disposal_confirmations_select ON public.disposal_confirmations;
DROP POLICY  IF EXISTS disposal_confirmations_insert ON public.disposal_confirmations;
DROP INDEX   IF EXISTS disposal_confirmations_company_idx;
DROP INDEX   IF EXISTS disposal_confirmations_tc_idx;

-- company_id/branch_id are dropped: a trip is not reliably 1:1 with a single
-- company/branch (it aggregates curb pickups from possibly several branches),
-- so tenant scoping for the generator side is done by joining pickup_events
-- via trip_id in the SELECT policy below, rather than by a copied column that
-- could misrepresent a milk-run trip.
ALTER TABLE public.disposal_confirmations
  DROP COLUMN pickup_event_id,
  DROP COLUMN company_id,
  DROP COLUMN branch_id,
  DROP COLUMN facility_name_ar,
  DROP COLUMN facility_license_number,
  DROP COLUMN ticket_path,
  DROP COLUMN ticket_sha256,
  ADD COLUMN trip_id                  uuid NOT NULL REFERENCES public.trips(id),
  ADD COLUMN facility_id              uuid NOT NULL REFERENCES public.facilities(id),
  ADD COLUMN status                   text NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed','rejected')),
  ADD COLUMN reject_reason            text,
  ADD COLUMN net_weight_kg            numeric(10,2) CHECK (net_weight_kg IS NULL OR net_weight_kg > 0),
  ADD COLUMN weighbridge_photo_path   text,
  ADD COLUMN weighbridge_photo_sha256 text,
  ADD COLUMN confirmed_by             uuid REFERENCES public.profiles(id),
  ADD COLUMN confirmed_at             timestamptz,
  ADD CONSTRAINT disposal_confirmations_status_fields_check CHECK (
    (status = 'confirmed' AND net_weight_kg IS NOT NULL AND reject_reason IS NULL)
    OR (status = 'rejected' AND reject_reason IS NOT NULL)
  );

-- One dropoff outcome per trip in v1 (SCOPE v1: one trip -> one dropoff).
CREATE UNIQUE INDEX disposal_confirmations_trip_id_uniq ON public.disposal_confirmations(trip_id);
CREATE INDEX disposal_confirmations_facility_idx ON public.disposal_confirmations(facility_id, confirmed_at DESC);
CREATE INDEX disposal_confirmations_tc_idx       ON public.disposal_confirmations(transport_company_id, confirmed_at DESC);


-- ═══════════════════════════════════════════════════════════════════════════
-- PART B — RLS (enable + policies), FUNCTIONS, TRIGGERS, GRANTS
-- Every table PART A created/altered above now exists, so nothing below can
-- hit a "relation does not exist" forward reference.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────
-- B1. facilities RLS
-- INSERT: service_role only — no self-registration, mirroring companies /
-- transport_companies (platform onboarding via the recycler-invite endpoint).
-- UPDATE: the facility's own recycler_manager, or admin.
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.facilities ENABLE ROW LEVEL SECURITY;

CREATE POLICY facilities_select ON public.facilities
  FOR SELECT TO authenticated
  USING (
    (public.my_membership()).role = 'admin'
    OR id IN (SELECT m.facility_id FROM public.memberships m WHERE m.user_id = auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.facility_transporters ft
      WHERE ft.status = 'active'
        AND ft.transport_company_id = (public.my_membership()).transport_company_id
        AND ft.facility_id = facilities.id
    )
  );

CREATE POLICY facilities_update ON public.facilities
  FOR UPDATE TO authenticated
  USING (
    (public.my_membership()).role = 'admin'
    OR (
      id = (public.my_membership()).facility_id
      AND (public.my_membership()).role = 'recycler_manager'
    )
  );

GRANT SELECT, UPDATE ON public.facilities TO authenticated;
GRANT ALL             ON public.facilities TO service_role;

-- ─────────────────────────────────────────────────────────────
-- B2. facility_transporters RLS
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.facility_transporters ENABLE ROW LEVEL SECURITY;

CREATE POLICY facility_transporters_select ON public.facility_transporters
  FOR SELECT TO authenticated
  USING (
    (public.my_membership()).facility_id = facility_id
    OR (public.my_membership()).transport_company_id = transport_company_id
    OR (public.my_membership()).role = 'admin'
  );

CREATE POLICY facility_transporters_insert ON public.facility_transporters
  FOR INSERT TO authenticated
  WITH CHECK (
    (
      (public.my_membership()).facility_id = facility_id
      AND (public.my_membership()).role = 'recycler_manager'
    )
    OR (public.my_membership()).role = 'admin'
  );

CREATE POLICY facility_transporters_update ON public.facility_transporters
  FOR UPDATE TO authenticated
  USING (
    (
      (public.my_membership()).facility_id = facility_id
      AND (public.my_membership()).role = 'recycler_manager'
    )
    OR (public.my_membership()).role = 'admin'
  );

GRANT SELECT, INSERT, UPDATE ON public.facility_transporters TO authenticated;
GRANT ALL                     ON public.facility_transporters TO service_role;

-- ─────────────────────────────────────────────────────────────
-- B3. trips: RLS, functions, triggers
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.trips ENABLE ROW LEVEL SECURITY;

-- B3a. BEFORE INSERT: validate driver/vehicle/facility-link, force created_by
--      (mirrors pickup_events_before_insert's FK-consistency checks).
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

CREATE TRIGGER trips_before_insert_trigger
  BEFORE INSERT ON public.trips
  FOR EACH ROW EXECUTE FUNCTION public.trips_before_insert();

-- B3b. BEFORE UPDATE: reconciliation fields + status='reconciled' are
--      server-computed. Only reconcile_trip_weight() (which sets the
--      session-local 'tadweer.internal_update' flag) may move a trip into
--      'reconciled' or change the reconciliation columns. A direct client
--      UPDATE attempting either is rejected / silently pinned to the old
--      value, so the client can never self-declare reconciliation.
CREATE OR REPLACE FUNCTION public.trips_before_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF current_setting('tadweer.internal_update', true) IS DISTINCT FROM 'on' THEN
    IF NEW.status = 'reconciled' AND OLD.status <> 'reconciled' THEN
      RAISE EXCEPTION 'RECONCILED_STATUS_IS_SERVER_ONLY: trips.status may only become '
        'reconciled via a confirmed disposal_confirmations row' USING ERRCODE = 'P0010';
    END IF;
    NEW.weight_reconciliation_status := OLD.weight_reconciliation_status;
    NEW.reconciled_net_weight_kg     := OLD.reconciled_net_weight_kg;
    NEW.reconciled_pickup_weight_kg  := OLD.reconciled_pickup_weight_kg;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trips_before_update_trigger
  BEFORE UPDATE ON public.trips
  FOR EACH ROW EXECUTE FUNCTION public.trips_before_update();

-- B3c. Audit trail (trips are mutable, unlike pickup_events/audit_log).
CREATE OR REPLACE FUNCTION public.trips_after_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.audit_log (user_id, tenant_id, tenant_type, action, entity_type, entity_id)
  VALUES (NEW.created_by, NEW.transport_company_id, 'transport_company', 'create_trip', 'trips', NEW.id);
  RETURN NEW;
END;
$$;

CREATE TRIGGER trips_after_insert_trigger
  AFTER INSERT ON public.trips
  FOR EACH ROW EXECUTE FUNCTION public.trips_after_insert();

CREATE OR REPLACE FUNCTION public.trips_after_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW IS NOT DISTINCT FROM OLD THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.audit_log (user_id, tenant_id, tenant_type, action, entity_type, entity_id, changes)
  VALUES (
    auth.uid(),
    NEW.transport_company_id,
    'transport_company',
    'update_trip',
    'trips',
    NEW.id,
    jsonb_build_object(
      'old_status', OLD.status, 'new_status', NEW.status,
      'old_weight_reconciliation_status', OLD.weight_reconciliation_status,
      'new_weight_reconciliation_status', NEW.weight_reconciliation_status
    )
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER trips_after_update_trigger
  AFTER UPDATE ON public.trips
  FOR EACH ROW EXECUTE FUNCTION public.trips_after_update();

-- B3d. trips RLS
--      SELECT/UPDATE: transport staff (whole fleet) or the assigned driver
--      (own trips only, mirrors pickup_assignments' driver scoping), or the
--      receiving facility's members, or admin.
CREATE POLICY trips_select ON public.trips
  FOR SELECT TO authenticated
  USING (
    (public.my_membership()).role = 'admin'
    OR planned_facility_id = (public.my_membership()).facility_id
    OR (
      transport_company_id = (public.my_membership()).transport_company_id
      AND (
        (public.my_membership()).role IN ('owner','manager','dispatcher')
        OR EXISTS (
          SELECT 1 FROM public.drivers d
          WHERE d.id = trips.driver_id AND d.profile_id = auth.uid()
        )
      )
    )
  );

CREATE POLICY trips_insert ON public.trips
  FOR INSERT TO authenticated
  WITH CHECK (
    (public.my_membership()).role IN ('owner','manager','dispatcher')
    AND transport_company_id = (public.my_membership()).transport_company_id
    AND created_by = auth.uid()
  );

CREATE POLICY trips_update ON public.trips
  FOR UPDATE TO authenticated
  USING (
    (public.my_membership()).role = 'admin'
    OR (
      transport_company_id = (public.my_membership()).transport_company_id
      AND (
        (public.my_membership()).role IN ('owner','manager','dispatcher')
        OR EXISTS (
          SELECT 1 FROM public.drivers d
          WHERE d.id = trips.driver_id AND d.profile_id = auth.uid()
        )
      )
    )
  );

GRANT SELECT, INSERT, UPDATE ON public.trips TO authenticated;
GRANT ALL                     ON public.trips TO service_role;

-- ─────────────────────────────────────────────────────────────
-- B4. pickup_events_before_insert: extend with optional trip linkage
--     validation (replaces 013's version in place; all prior logic kept
--     verbatim, only step 4b is new).
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

  IF NEW.gps_lat IS NOT NULL AND NEW.gps_lng IS NOT NULL
     AND (NEW.gps_accuracy_m IS NULL OR NEW.gps_accuracy_m > 50)
  THEN
    v_score := v_score + 10;  v_flags := v_flags || ARRAY['gps_low_accuracy'];
  END IF;

  IF NEW.qr_code_value IS NOT NULL AND NOT NEW.qr_verified THEN
    v_score := v_score + 10;  v_flags := v_flags || ARRAY['qr_mismatch'];
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
-- B5. waste_stream_tolerances RLS
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.waste_stream_tolerances ENABLE ROW LEVEL SECURITY;

CREATE POLICY waste_stream_tolerances_select ON public.waste_stream_tolerances
  FOR SELECT TO authenticated
  USING (true);
-- INSERT/UPDATE: service_role / admin console only (config, not tenant data).

GRANT SELECT ON public.waste_stream_tolerances TO authenticated;
GRANT ALL    ON public.waste_stream_tolerances TO service_role;

-- ─────────────────────────────────────────────────────────────
-- B6. disposal_confirmations: functions, triggers, RLS
-- ─────────────────────────────────────────────────────────────

-- B6a. BEFORE INSERT: force facility_id/transport_company_id from the trip
--      (never client-writable), force confirmed_by/confirmed_at.
CREATE OR REPLACE FUNCTION public.disposal_confirmations_before_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_trip public.trips%ROWTYPE;
BEGIN
  SELECT * INTO v_trip FROM public.trips WHERE id = NEW.trip_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'TRIP_NOT_FOUND: trip_id % does not exist', NEW.trip_id
      USING ERRCODE = 'P0002';
  END IF;

  -- Facility/transport identity comes from the trip, never from the client —
  -- this is what stops a scale_operator confirming a trip planned for a
  -- different facility.
  NEW.facility_id           := v_trip.planned_facility_id;
  NEW.transport_company_id  := v_trip.transport_company_id;

  IF auth.uid() IS NOT NULL THEN
    NEW.confirmed_by := auth.uid();
  END IF;
  NEW.confirmed_at := now();

  RETURN NEW;
END;
$$;

CREATE TRIGGER disposal_confirmations_before_insert_trigger
  BEFORE INSERT ON public.disposal_confirmations
  FOR EACH ROW EXECUTE FUNCTION public.disposal_confirmations_before_insert();

-- B6b. AFTER INSERT: audit trail + trigger reconciliation on confirmation.
CREATE OR REPLACE FUNCTION public.disposal_confirmations_after_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.audit_log (user_id, tenant_id, tenant_type, action, entity_type, entity_id)
  VALUES (
    NEW.confirmed_by, NEW.facility_id, 'facility',
    CASE WHEN NEW.status = 'confirmed' THEN 'create_disposal_confirmation' ELSE 'reject_disposal' END,
    'disposal_confirmations', NEW.id
  );

  IF NEW.status = 'confirmed' THEN
    PERFORM public.reconcile_trip_weight(NEW.trip_id, NEW.net_weight_kg);
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER disposal_confirmations_after_insert_trigger
  AFTER INSERT ON public.disposal_confirmations
  FOR EACH ROW EXECUTE FUNCTION public.disposal_confirmations_after_insert();

-- B6c. RLS
--      INSERT: ONLY a scale_operator of the RECEIVING facility. facility_id
--      is server-forced (B6a) from the trip, so this also rejects a
--      scale_operator of facility A confirming facility B's trip, and rejects
--      any transporter-side member outright (their role is never
--      'scale_operator' and my_membership().facility_id is NULL for them).
CREATE POLICY disposal_confirmations_select ON public.disposal_confirmations
  FOR SELECT TO authenticated
  USING (
    (public.my_membership()).role = 'admin'
    OR facility_id = (public.my_membership()).facility_id
    OR transport_company_id = (public.my_membership()).transport_company_id
    OR EXISTS (
      SELECT 1 FROM public.pickup_events pe
      WHERE pe.trip_id = disposal_confirmations.trip_id
        AND pe.company_id = (public.my_membership()).company_id
    )
  );

CREATE POLICY disposal_confirmations_insert ON public.disposal_confirmations
  FOR INSERT TO authenticated
  WITH CHECK (
    (public.my_membership()).role = 'scale_operator'
    AND facility_id = (public.my_membership()).facility_id
    AND confirmed_by = auth.uid()
  );

-- GRANT/REVOKE from 010 (SELECT, INSERT to authenticated; UPDATE/DELETE
-- revoked; ALL to service_role) are table-level and remain in force.

-- ─────────────────────────────────────────────────────────────
-- B7. RECONCILIATION
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.reconcile_trip_weight(p_trip_id uuid, p_net_weight_kg numeric)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_trip       public.trips%ROWTYPE;
  v_pickup_sum numeric;
  v_tolerance  numeric;
  v_diff_pct   numeric;
  v_result     text;
BEGIN
  SELECT * INTO v_trip FROM public.trips WHERE id = p_trip_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT COALESCE(SUM(weight_kg), 0) INTO v_pickup_sum
  FROM public.pickup_events_latest
  WHERE trip_id = p_trip_id;

  SELECT tolerance_pct INTO v_tolerance
  FROM public.waste_stream_tolerances
  WHERE waste_stream = v_trip.waste_stream;

  IF v_tolerance IS NULL THEN
    v_tolerance := 2.00;  -- default fallback; per-stream override via waste_stream_tolerances
  END IF;

  IF v_pickup_sum = 0 THEN
    v_diff_pct := 100;
  ELSE
    v_diff_pct := ABS(p_net_weight_kg - v_pickup_sum) / v_pickup_sum * 100;
  END IF;

  v_result := CASE WHEN v_diff_pct <= v_tolerance THEN 'within_tolerance' ELSE 'flagged' END;

  -- Flip the session-local flag so trips_before_update permits the
  -- server-only 'reconciled' transition and reconciliation-column writes.
  PERFORM set_config('tadweer.internal_update', 'on', true);
  UPDATE public.trips
  SET status                       = 'reconciled',
      weight_reconciliation_status = v_result,
      reconciled_net_weight_kg     = p_net_weight_kg,
      reconciled_pickup_weight_kg  = v_pickup_sum
  WHERE id = p_trip_id;
  PERFORM set_config('tadweer.internal_update', 'off', true);
END;
$$;

-- Defense in depth: Postgres grants EXECUTE to PUBLIC by default on new
-- functions. Without this revoke, any authenticated user could call
-- reconcile_trip_weight() directly via RPC to force a fake reconciliation
-- (e.g. flip a trip to 'reconciled'/'within_tolerance' with an arbitrary
-- weight, with no confirmed disposal_confirmations row backing it).
REVOKE EXECUTE ON FUNCTION public.reconcile_trip_weight(uuid, numeric) FROM PUBLIC, authenticated, anon;

-- ─────────────────────────────────────────────────────────────
-- B7a. Correction path for a mistaken confirmation.
--
-- disposal_confirmations is append-only by design (UPDATE/DELETE revoked
-- from authenticated/anon at the privilege layer) and trip_id is UNIQUE, so
-- a scale_operator who fat-fingers the net weight has NO client-side way to
-- fix it, and re-submitting a second confirmation for the same trip is
-- blocked outright. Rather than leave that with zero recourse, this is a
-- narrow, audited, service_role-only override: it corrects net_weight_kg on
-- an existing 'confirmed' row, writes a mandatory-reason audit_log entry
-- (action = 'admin_override_disposal_weight'), and re-runs reconciliation
-- against the corrected figure. It intentionally does NOT touch status,
-- reject_reason, confirmed_by/confirmed_at, or the evidence photo/hash —
-- those stay exactly as originally recorded; only the disputed number moves,
-- and the audit trail shows both who did it and why.
--
-- Not reachable by any client role: EXECUTE is revoked from PUBLIC/
-- authenticated/anon below, and only granted to service_role. Call it from
-- an admin/support-only backend endpoint (never expose it in browser code),
-- with the reason coming from an actual support ticket / review note.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_override_disposal_weight(
  p_confirmation_id uuid,
  p_net_weight_kg   numeric,
  p_reason          text,
  p_actor           uuid DEFAULT NULL
)
RETURNS public.disposal_confirmations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_row public.disposal_confirmations%ROWTYPE;
BEGIN
  IF p_reason IS NULL OR length(trim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'OVERRIDE_REASON_REQUIRED' USING ERRCODE = 'P0011';
  END IF;
  IF p_net_weight_kg IS NULL OR p_net_weight_kg <= 0 THEN
    RAISE EXCEPTION 'OVERRIDE_NET_WEIGHT_INVALID' USING ERRCODE = 'P0013';
  END IF;

  SELECT * INTO v_row FROM public.disposal_confirmations WHERE id = p_confirmation_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CONFIRMATION_NOT_FOUND: %', p_confirmation_id USING ERRCODE = 'P0002';
  END IF;
  IF v_row.status <> 'confirmed' THEN
    RAISE EXCEPTION 'OVERRIDE_ONLY_ON_CONFIRMED_ROWS: % is not confirmed', p_confirmation_id
      USING ERRCODE = 'P0012';
  END IF;

  UPDATE public.disposal_confirmations
  SET net_weight_kg = p_net_weight_kg
  WHERE id = p_confirmation_id
  RETURNING * INTO v_row;

  INSERT INTO public.audit_log (user_id, tenant_id, tenant_type, action, entity_type, entity_id, changes)
  VALUES (
    COALESCE(p_actor, auth.uid()), v_row.facility_id, 'facility',
    'admin_override_disposal_weight', 'disposal_confirmations', v_row.id,
    jsonb_build_object('reason', p_reason, 'corrected_net_weight_kg', p_net_weight_kg)
  );

  PERFORM public.reconcile_trip_weight(v_row.trip_id, p_net_weight_kg);

  RETURN v_row;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_override_disposal_weight(uuid, numeric, text, uuid) FROM PUBLIC, authenticated, anon;
GRANT  EXECUTE ON FUNCTION public.admin_override_disposal_weight(uuid, numeric, text, uuid) TO service_role;

-- ─────────────────────────────────────────────────────────────
-- B8. Custody-complete helper
--     Plain (non-SECURITY DEFINER) function: runs under the caller's own RLS
--     view of disposal_confirmations, which already covers every legitimate
--     viewer (facility, transporter, and the generator company via the
--     pickup_events join in policy B6c).
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.is_trip_custody_complete(p_trip_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.disposal_confirmations
    WHERE trip_id = p_trip_id AND status = 'confirmed'
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_trip_custody_complete(uuid) TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- B9. STORAGE: weighbridge-photos bucket (private, append-only, facility-scoped)
--     Path convention: {facility_id}/{trip_id}/{filename}
-- ═══════════════════════════════════════════════════════════════════════════
INSERT INTO storage.buckets (id, name, public)
VALUES ('weighbridge-photos', 'weighbridge-photos', false)
ON CONFLICT (id) DO NOTHING;

-- Read access: the receiving facility's own members, or a party to that
-- SPECIFIC trip (the transporter that owns it, or a generator company with a
-- pickup_event under it) — mirrors storage_company_prefix_allowed's pattern
-- (008) but keyed on facility_id + trip_id instead of company_id.
CREATE OR REPLACE FUNCTION public.storage_weighbridge_prefix_allowed(p_facility_folder text, p_trip_folder text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(
    (public.my_membership()).role = 'admin'
    OR (public.my_membership()).facility_id::text = p_facility_folder
    OR EXISTS (
      SELECT 1 FROM public.trips t
      WHERE t.id::text = p_trip_folder
        AND t.planned_facility_id::text = p_facility_folder
        AND (
          t.transport_company_id = (public.my_membership()).transport_company_id
          OR EXISTS (
            SELECT 1 FROM public.pickup_events pe
            WHERE pe.trip_id = t.id
              AND pe.company_id = (public.my_membership()).company_id
          )
        )
    ),
    false
  );
$$;

GRANT EXECUTE ON FUNCTION public.storage_weighbridge_prefix_allowed(text, text) TO authenticated;

CREATE POLICY weighbridge_photos_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'weighbridge-photos'
    AND (public.my_membership()).role = 'scale_operator'
    AND (public.my_membership()).facility_id::text = (storage.foldername(name))[1]
  );

CREATE POLICY weighbridge_photos_select ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'weighbridge-photos'
    AND public.storage_weighbridge_prefix_allowed(
      (storage.foldername(name))[1],
      (storage.foldername(name))[2]
    )
  );

-- Append-only (no UPDATE/DELETE) is already enforced bucket-agnostically by
-- migration 005's evidence_no_update / evidence_no_delete policies, which
-- apply to ALL of storage.objects for authenticated/anon regardless of
-- bucket_id — weighbridge-photos inherits that automatically.

-- ═══════════════════════════════════════════════════════════════════════════
-- END OF MIGRATION 018
-- ═══════════════════════════════════════════════════════════════════════════
