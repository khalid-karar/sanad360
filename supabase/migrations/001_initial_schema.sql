-- ═══════════════════════════════════════════════════════════════════════════
-- Tadweer360 – Phase 1 Initial Schema
-- ═══════════════════════════════════════════════════════════════════════════
-- Conventions:
--   • All timestamps are timestamptz (UTC). App displays Arabia/Riyadh.
--   • Tables use gen_random_uuid() PKs.
--   • pickup_events and audit_log are INSERT-only (privileges revoked below).
--   • Every table has RLS enabled; policies follow data definitions.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────
-- 1. ENUM TYPES
-- ─────────────────────────────────────────────────────────────
CREATE TYPE public.member_role AS ENUM
  ('owner', 'manager', 'driver', 'dispatcher', 'admin');

-- ─────────────────────────────────────────────────────────────
-- 2. COMPANIES  (food-sector tenants)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE public.companies (
  id                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name_ar                 text        NOT NULL,
  name_en                 text,
  commercial_registration text        NOT NULL UNIQUE,  -- السجل التجاري
  vat_number              text,
  created_at              timestamptz NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────────────────────────
-- 3. BRANCHES  (one company → many locations)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE public.branches (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  name_ar           text        NOT NULL,
  name_en           text,
  address_ar        text,
  city              text,
  geofence_lat      numeric(10,7),
  geofence_lng      numeric(10,7),
  geofence_radius_m integer     NOT NULL DEFAULT 150,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX branches_company_id_idx ON public.branches(company_id);

-- ─────────────────────────────────────────────────────────────
-- 4. TRANSPORT COMPANIES  (licensed waste carriers)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE public.transport_companies (
  id                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name_ar                 text        NOT NULL,
  name_en                 text,
  commercial_registration text        NOT NULL UNIQUE,
  ncwm_license_number     text,
  ncwm_license_expiry     date,
  created_at              timestamptz NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────────────────────────
-- 5. PROFILES  (extends auth.users; one row per user)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE public.profiles (
  id          uuid        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name_ar     text        NOT NULL DEFAULT '',
  name_en     text,
  phone       text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────────────────────────
-- 6. MEMBERSHIPS  (user ↔ tenant ↔ role)
-- ─────────────────────────────────────────────────────────────
-- NOTE: No UNIQUE on user_id intentionally. When the multi-company consultant
-- channel lands, one user will hold memberships in multiple tenants. The
-- my_membership() helper currently uses LIMIT 1 (single-tenant behaviour)
-- and must be replaced with a tenant-parameterized lookup at that point.
CREATE TABLE public.memberships (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role                  public.member_role NOT NULL,
  -- Exactly one of these two must be set (both null only when role = 'admin')
  company_id            uuid        REFERENCES public.companies(id),
  transport_company_id  uuid        REFERENCES public.transport_companies(id),
  -- Optional: driver/dispatcher pinned to a specific branch
  branch_id             uuid        REFERENCES public.branches(id),
  created_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT one_tenant CHECK (
    (company_id IS NOT NULL AND transport_company_id IS NULL)
    OR (company_id IS NULL  AND transport_company_id IS NOT NULL)
    OR (role = 'admin' AND company_id IS NULL AND transport_company_id IS NULL)
  )
);
CREATE INDEX memberships_user_id_idx             ON public.memberships(user_id);
CREATE INDEX memberships_company_id_idx          ON public.memberships(company_id);
CREATE INDEX memberships_transport_company_id_idx ON public.memberships(transport_company_id);

-- ─────────────────────────────────────────────────────────────
-- 7. DRIVERS  (PDPL: personal data — store only what is needed)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE public.drivers (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  transport_company_id uuid        NOT NULL REFERENCES public.transport_companies(id),
  profile_id           uuid        REFERENCES public.profiles(id),
  name_ar              text        NOT NULL,
  license_number       text        NOT NULL,
  license_expiry       date        NOT NULL,
  absher_verified      boolean     NOT NULL DEFAULT false,
  status               text        NOT NULL DEFAULT 'active'
                                   CHECK (status IN ('active','inactive','suspended')),
  created_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX drivers_transport_company_id_idx ON public.drivers(transport_company_id);
CREATE INDEX drivers_license_expiry_idx       ON public.drivers(license_expiry);

-- ─────────────────────────────────────────────────────────────
-- 8. VEHICLES
-- ─────────────────────────────────────────────────────────────
CREATE TABLE public.vehicles (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  transport_company_id uuid        NOT NULL REFERENCES public.transport_companies(id),
  plate_number         text        NOT NULL,
  type                 text        NOT NULL
                                   CHECK (type IN ('small_truck','medium_truck','large_truck','specialized')),
  waste_license_type   text        NOT NULL
                                   CHECK (waste_license_type IN ('general','medical','hazardous','industrial','electronic')),
  ncwm_license_number  text,
  ncwm_license_expiry  date        NOT NULL,
  status               text        NOT NULL DEFAULT 'active'
                                   CHECK (status IN ('active','inactive')),
  created_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX vehicles_transport_company_id_idx ON public.vehicles(transport_company_id);
CREATE INDEX vehicles_ncwm_license_expiry_idx  ON public.vehicles(ncwm_license_expiry);

-- ─────────────────────────────────────────────────────────────
-- 9. PICKUP EVENTS  ── APPEND-ONLY IMMUTABLE LEDGER ──
--
-- Rules enforced here + via privilege revocation below:
--   (a) No UPDATE, no DELETE — ever.
--   (b) logical_id groups all revisions of one logical pickup.
--   (c) Revision 1 is the original; corrections INSERT a new row:
--         same logical_id, revision = prev_max + 1,
--         supersedes_id = id of previous row.
--   (d) created_at set by server DEFAULT — never sent by client.
--   (e) created_by defaults to auth.uid() — not spoofable by client.
--   (f) geofence_verified is computed server-side by a BEFORE INSERT trigger.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE public.pickup_events (
  -- Identity
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  logical_id            uuid        NOT NULL,
  revision              integer     NOT NULL DEFAULT 1 CHECK (revision > 0),
  supersedes_id         uuid        REFERENCES public.pickup_events(id),

  -- Tenant scoping (RLS from both sides)
  company_id            uuid        NOT NULL REFERENCES public.companies(id),
  branch_id             uuid        NOT NULL REFERENCES public.branches(id),
  transport_company_id  uuid        NOT NULL REFERENCES public.transport_companies(id),

  -- Participants
  driver_id             uuid        NOT NULL REFERENCES public.drivers(id),
  vehicle_id            uuid        NOT NULL REFERENCES public.vehicles(id),

  -- Evidence
  waste_types           text[]      NOT NULL DEFAULT '{}',
  weight_kg             numeric(8,2) NOT NULL CHECK (weight_kg > 0),
  gps_lat               numeric(10,7),
  gps_lng               numeric(10,7),
  gps_accuracy_m        numeric(6,1),
  geofence_verified     boolean     NOT NULL DEFAULT false,  -- overwritten by trigger
  qr_code_value         text,
  photo_path            text,
  receipt_path          text,
  signature_path        text,

  -- Risk (placeholder — computed by Phase 2 trigger)
  risk_score            integer     NOT NULL DEFAULT 0  CHECK (risk_score BETWEEN 0 AND 100),
  risk_flags            text[]      NOT NULL DEFAULT '{}',
  compliance_status     text        NOT NULL DEFAULT 'compliant'
                                    CHECK (compliance_status IN ('compliant','warning','non_compliant')),

  -- Correction reason (null for revision 1)
  notes                 text,

  -- Immutable audit fields (server-set).
  -- created_by is nullable so service_role inserts (tests, backend, seed) don't fail
  -- when auth.uid() is NULL.  For authenticated clients, the BEFORE INSERT trigger
  -- enforces created_by = auth.uid() and the INSERT RLS policy also requires it.
  created_by            uuid        REFERENCES public.profiles(id),
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX pickup_events_logical_revision_uniq
  ON public.pickup_events(logical_id, revision);
CREATE INDEX pickup_events_company_created_idx
  ON public.pickup_events(company_id, created_at DESC);
CREATE INDEX pickup_events_transport_created_idx
  ON public.pickup_events(transport_company_id, created_at DESC);
CREATE INDEX pickup_events_logical_id_idx  ON public.pickup_events(logical_id);
CREATE INDEX pickup_events_driver_id_idx   ON public.pickup_events(driver_id);

-- ─────────────────────────────────────────────────────────────
-- 9a. LATEST-REVISION VIEW
--     security_invoker = true  →  view runs under the CALLER's role,
--     so RLS on the base table is always enforced. Without this the
--     view would bypass tenant isolation.
-- ─────────────────────────────────────────────────────────────
CREATE VIEW public.pickup_events_latest
  WITH (security_invoker = true) AS
SELECT DISTINCT ON (logical_id) *
FROM public.pickup_events
ORDER BY logical_id, revision DESC;

-- ─────────────────────────────────────────────────────────────
-- 10. AUDIT LOG  ── also INSERT-only ──
-- ─────────────────────────────────────────────────────────────
CREATE TABLE public.audit_log (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid        REFERENCES public.profiles(id),
  tenant_id     uuid,
  tenant_type   text,        -- 'company' | 'transport_company' | 'admin'
  action        text        NOT NULL,
  entity_type   text,
  entity_id     uuid,
  changes       jsonb,
  ip_address    inet,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_tenant_idx  ON public.audit_log(tenant_id, created_at DESC);
CREATE INDEX audit_log_user_id_idx ON public.audit_log(user_id);

-- ─────────────────────────────────────────────────────────────
-- 11. INSPECTION PDFS  (Phase 2 writes here; table created now)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE public.inspection_pdfs (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid        NOT NULL REFERENCES public.companies(id),
  branch_id         uuid        REFERENCES public.branches(id),
  pickup_event_id   uuid        REFERENCES public.pickup_events(id),
  report_type       text        NOT NULL
                                CHECK (report_type IN ('single_pickup','monthly_summary')),
  period_month      date,
  pdf_path          text        NOT NULL,
  sha256_hash       text        NOT NULL,
  generated_by      uuid        NOT NULL REFERENCES public.profiles(id),
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX inspection_pdfs_company_id_idx ON public.inspection_pdfs(company_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- TRIGGERS
-- ═══════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────
-- T1. Auto-create profile row when a new auth.users row is inserted.
--     SECURITY DEFINER + search_path locked to prevent search-path hijacking.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.profiles (id, name_ar, phone)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'name_ar', ''),
    NEW.phone
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ─────────────────────────────────────────────────────────────
-- T2. BEFORE INSERT on pickup_events:
--     (a) Validates FK consistency (branch → company; driver/vehicle → transport_company).
--     (b) Computes geofence_verified via haversine (no PostGIS).
--     (c) Enforces created_by = auth.uid() so client cannot spoof it.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.pickup_events_before_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_branch            public.branches%ROWTYPE;
  v_driver_tc_id      uuid;
  v_vehicle_tc_id     uuid;
  v_dlat              double precision;
  v_dlng              double precision;
  v_a                 double precision;
  v_dist_m            double precision;
BEGIN
  -- 1. Enforce created_by = caller (not spoofable)
  NEW.created_by := auth.uid();

  -- 2. Validate branch belongs to company
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

  -- 3. Validate driver belongs to transport_company
  SELECT transport_company_id INTO v_driver_tc_id
  FROM public.drivers
  WHERE id = NEW.driver_id;

  IF v_driver_tc_id IS NULL OR v_driver_tc_id <> NEW.transport_company_id THEN
    RAISE EXCEPTION 'DRIVER_TRANSPORT_MISMATCH: driver_id % does not belong to transport_company_id %',
      NEW.driver_id, NEW.transport_company_id
      USING ERRCODE = 'P0004';
  END IF;

  -- 4. Validate vehicle belongs to transport_company
  SELECT transport_company_id INTO v_vehicle_tc_id
  FROM public.vehicles
  WHERE id = NEW.vehicle_id;

  IF v_vehicle_tc_id IS NULL OR v_vehicle_tc_id <> NEW.transport_company_id THEN
    RAISE EXCEPTION 'VEHICLE_TRANSPORT_MISMATCH: vehicle_id % does not belong to transport_company_id %',
      NEW.vehicle_id, NEW.transport_company_id
      USING ERRCODE = 'P0005';
  END IF;

  -- 5. Compute geofence_verified via plpgsql haversine
  --    (always overwrite whatever the client sent)
  IF NEW.gps_lat IS NULL
     OR NEW.gps_lng IS NULL
     OR v_branch.geofence_lat IS NULL
     OR v_branch.geofence_lng IS NULL
  THEN
    NEW.geofence_verified := false;
  ELSE
    v_dlat := radians(NEW.gps_lat::double precision - v_branch.geofence_lat::double precision);
    v_dlng := radians(NEW.gps_lng::double precision - v_branch.geofence_lng::double precision);
    v_a := sin(v_dlat / 2) ^ 2
          + cos(radians(v_branch.geofence_lat::double precision))
          * cos(radians(NEW.gps_lat::double precision))
          * sin(v_dlng / 2) ^ 2;
    v_dist_m := 2 * 6371000 * asin(sqrt(v_a));  -- Earth radius 6371 km
    NEW.geofence_verified := (v_dist_m <= v_branch.geofence_radius_m::double precision);
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER pickup_events_before_insert_trigger
  BEFORE INSERT ON public.pickup_events
  FOR EACH ROW EXECUTE FUNCTION public.pickup_events_before_insert();

-- ─────────────────────────────────────────────────────────────
-- T3. AFTER INSERT on pickup_events → write audit_log row.
--     Runs server-side so the client cannot skip auditing.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.pickup_events_after_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.audit_log (
    user_id, tenant_id, tenant_type,
    action, entity_type, entity_id
  ) VALUES (
    NEW.created_by,
    NEW.company_id,
    'company',
    CASE WHEN NEW.revision = 1 THEN 'create_pickup_event'
         ELSE 'create_pickup_revision' END,
    'pickup_events',
    NEW.id
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER pickup_events_after_insert_trigger
  AFTER INSERT ON public.pickup_events
  FOR EACH ROW EXECUTE FUNCTION public.pickup_events_after_insert();

-- ═══════════════════════════════════════════════════════════════════════════
-- ROLE GRANTS
-- Grant table-level privileges first; RLS policies below then restrict
-- which rows each role can actually touch.
-- ═══════════════════════════════════════════════════════════════════════════
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

-- service_role: full access to all tables (used by backend services / seed).
-- Bypasses RLS but NOT table-level privileges, so explicit grants are required.
GRANT ALL ON ALL TABLES    IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;

-- authenticated: per-table grants; RLS policies below further restrict per-row
GRANT SELECT, INSERT, UPDATE ON public.profiles            TO authenticated;
GRANT SELECT                  ON public.memberships        TO authenticated;
GRANT SELECT                  ON public.companies          TO authenticated;
GRANT SELECT                  ON public.branches           TO authenticated;
GRANT SELECT                  ON public.transport_companies TO authenticated;
GRANT SELECT                  ON public.drivers            TO authenticated;
GRANT SELECT                  ON public.vehicles           TO authenticated;
GRANT SELECT, INSERT          ON public.pickup_events      TO authenticated;
GRANT SELECT                  ON public.audit_log          TO authenticated;
GRANT SELECT, INSERT          ON public.inspection_pdfs    TO authenticated;

-- Sequences (needed for INSERT on tables with serial/bigserial PKs, if any)
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- APPEND-ONLY PRIVILEGE REVOCATIONS
-- Tighten pickup_events and audit_log further: even with RLS disabled,
-- UPDATE and DELETE are blocked at the privilege layer.
-- ═══════════════════════════════════════════════════════════════════════════
REVOKE UPDATE, DELETE ON public.pickup_events FROM authenticated, anon;
REVOKE UPDATE, DELETE ON public.audit_log     FROM authenticated, anon;

-- ═══════════════════════════════════════════════════════════════════════════
-- ROW-LEVEL SECURITY
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.companies           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.branches            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transport_companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.memberships         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.drivers             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicles            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pickup_events       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_log           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inspection_pdfs     ENABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────────────────────
-- RLS HELPER: my_membership()
-- Returns the caller's single membership row.
-- SECURITY DEFINER so it can read memberships without a recursive
-- RLS loop. search_path locked to '' to prevent hijacking.
--
-- MULTI-MEMBERSHIP NOTE: when the consultant channel lands (one
-- user → many companies), replace LIMIT 1 with a tenant_id
-- parameter and update all policies that call this function.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.my_membership()
RETURNS public.memberships
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT * FROM public.memberships
  WHERE user_id = auth.uid()
  LIMIT 1;
$$;

-- ─────────────────────────────────────────────────────────────
-- companies
-- ─────────────────────────────────────────────────────────────
CREATE POLICY companies_select ON public.companies FOR SELECT
  USING (
    id = (public.my_membership()).company_id
    OR (public.my_membership()).role = 'admin'
  );
-- INSERT/UPDATE: service_role only (platform onboarding / seed)

-- ─────────────────────────────────────────────────────────────
-- branches
-- ─────────────────────────────────────────────────────────────
CREATE POLICY branches_select ON public.branches FOR SELECT
  USING (
    company_id = (public.my_membership()).company_id
    OR (public.my_membership()).role = 'admin'
  );

CREATE POLICY branches_insert ON public.branches FOR INSERT
  WITH CHECK (
    company_id = (public.my_membership()).company_id
    AND (public.my_membership()).role IN ('owner','manager')
  );

CREATE POLICY branches_update ON public.branches FOR UPDATE
  USING (
    company_id = (public.my_membership()).company_id
    AND (public.my_membership()).role IN ('owner','manager')
  );

-- ─────────────────────────────────────────────────────────────
-- transport_companies
-- ─────────────────────────────────────────────────────────────
CREATE POLICY transport_companies_select ON public.transport_companies FOR SELECT
  USING (
    id = (public.my_membership()).transport_company_id
    OR (public.my_membership()).role = 'admin'
  );

-- ─────────────────────────────────────────────────────────────
-- profiles  (own row only)
-- ─────────────────────────────────────────────────────────────
CREATE POLICY profiles_select ON public.profiles FOR SELECT
  USING (id = auth.uid());

CREATE POLICY profiles_update ON public.profiles FOR UPDATE
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- Insert is handled by the handle_new_user trigger (SECURITY DEFINER)

-- ─────────────────────────────────────────────────────────────
-- memberships  (own row only)
-- ─────────────────────────────────────────────────────────────
CREATE POLICY memberships_select ON public.memberships FOR SELECT
  USING (user_id = auth.uid());

-- ─────────────────────────────────────────────────────────────
-- drivers  (PDPL: transport company scope)
-- ─────────────────────────────────────────────────────────────
CREATE POLICY drivers_select ON public.drivers FOR SELECT
  USING (
    transport_company_id = (public.my_membership()).transport_company_id
    OR (public.my_membership()).role = 'admin'
  );

CREATE POLICY drivers_insert ON public.drivers FOR INSERT
  WITH CHECK (
    transport_company_id = (public.my_membership()).transport_company_id
    AND (public.my_membership()).role IN ('owner','manager','dispatcher')
  );

CREATE POLICY drivers_update ON public.drivers FOR UPDATE
  USING (
    transport_company_id = (public.my_membership()).transport_company_id
    AND (public.my_membership()).role IN ('owner','manager')
  );

-- ─────────────────────────────────────────────────────────────
-- vehicles
-- ─────────────────────────────────────────────────────────────
CREATE POLICY vehicles_select ON public.vehicles FOR SELECT
  USING (
    transport_company_id = (public.my_membership()).transport_company_id
    OR (public.my_membership()).role = 'admin'
  );

CREATE POLICY vehicles_insert ON public.vehicles FOR INSERT
  WITH CHECK (
    transport_company_id = (public.my_membership()).transport_company_id
    AND (public.my_membership()).role IN ('owner','manager')
  );

CREATE POLICY vehicles_update ON public.vehicles FOR UPDATE
  USING (
    transport_company_id = (public.my_membership()).transport_company_id
    AND (public.my_membership()).role IN ('owner','manager')
  );

-- ─────────────────────────────────────────────────────────────
-- pickup_events
-- ─────────────────────────────────────────────────────────────
CREATE POLICY pickup_events_select ON public.pickup_events FOR SELECT
  USING (
    company_id            = (public.my_membership()).company_id
    OR transport_company_id = (public.my_membership()).transport_company_id
    OR (
      (public.my_membership()).role = 'driver'
      AND created_by = auth.uid()
    )
    OR (public.my_membership()).role = 'admin'
  );

-- Both arms of the INSERT policy require created_by = auth.uid()
-- (belt-and-suspenders: the BEFORE INSERT trigger also enforces this)
CREATE POLICY pickup_events_insert_driver ON public.pickup_events FOR INSERT
  WITH CHECK (
    (public.my_membership()).role = 'driver'
    AND created_by = auth.uid()
    AND transport_company_id = (public.my_membership()).transport_company_id
  );

CREATE POLICY pickup_events_insert_manager ON public.pickup_events FOR INSERT
  WITH CHECK (
    (public.my_membership()).role IN ('owner','manager','dispatcher')
    AND created_by = auth.uid()
    AND transport_company_id = (public.my_membership()).transport_company_id
  );

-- UPDATE and DELETE already revoked at privilege level above.

-- ─────────────────────────────────────────────────────────────
-- audit_log
-- ─────────────────────────────────────────────────────────────
CREATE POLICY audit_log_select ON public.audit_log FOR SELECT
  USING (
    user_id = auth.uid()
    OR tenant_id = (public.my_membership()).company_id
    OR tenant_id = (public.my_membership()).transport_company_id
    OR (public.my_membership()).role = 'admin'
  );

-- Writes are performed by the SECURITY DEFINER trigger; client INSERT
-- is blocked to prevent log tampering.
-- (No INSERT policy → authenticated users cannot insert directly)

-- ─────────────────────────────────────────────────────────────
-- inspection_pdfs
-- ─────────────────────────────────────────────────────────────
CREATE POLICY inspection_pdfs_select ON public.inspection_pdfs FOR SELECT
  USING (
    company_id = (public.my_membership()).company_id
    OR (public.my_membership()).role = 'admin'
  );

CREATE POLICY inspection_pdfs_insert ON public.inspection_pdfs FOR INSERT
  WITH CHECK (
    company_id = (public.my_membership()).company_id
    AND (public.my_membership()).role IN ('owner','manager')
  );

-- ═══════════════════════════════════════════════════════════════════════════
-- END OF MIGRATION
-- ═══════════════════════════════════════════════════════════════════════════
