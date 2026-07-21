-- ═══════════════════════════════════════════════════════════════════════════
-- Sanad 360 – Migration 021: CP2 — Onboarding & compliance document gating
-- ═══════════════════════════════════════════════════════════════════════════
-- No entity goes ACTIVE without complete, current, verified documents.
--
-- This migration:
--   1. documents — polymorphic (owner_type + owner_id) evidence table.
--      Upload is tenant-role-gated; review (verify/reject) is
--      document_reviewer/admin ONLY, and structurally can never be the same
--      person as the uploader (document_reviewer is tenant-less, so it can
--      never satisfy the tenant-ownership check upload requires; a belt-
--      and-suspenders `uploaded_by = auth.uid()` guard on the review trigger
--      covers the admin-uploaded-then-admin-reviews edge case too).
--   2. required_documents — global config: which doc_types are mandatory per
--      owner_type. Seeded with the Saudi defaults from the brief.
--   3. owner_document_status(owner_type, owner_id) — SERVER-COMPUTED,
--      STABLE function returning completion_pct (0-100), a THREE-state
--      activation_status, and the specific missing/expired/unverified
--      doc_types + an expiring-soon (30/15/7 day) list. Nothing here is a
--      stored column — expiry crossing midnight is correct on the next read
--      with no cron job needed.
--
-- ACTIVATION STATUS — three reporting states:
--   'active'      — every required doc present, verified, unexpired.
--   'onboarding'  — incomplete (missing and/or pending review) but nothing
--                   is ACTIVELY wrong (nothing expired/rejected yet).
--   'restricted'  — a required doc EXPIRED or was REJECTED: something that
--                   used to be fine now isn't.
--
--   THE GATE IS NOT WEAKENED FOR ANY NEW driver/vehicle: operational
--   hard-blocking (scheduling / completing a pickup, below) triggers on
--   BOTH 'onboarding' AND 'restricted' — i.e. "not active" — for every
--   driver/vehicle row created FROM THIS MIGRATION FORWARD. What makes this
--   safe to ship is an explicit, narrow GRANDFATHER: drivers.compliance_exempt
--   / vehicles.compliance_exempt (added in Part A) is backfilled to TRUE for
--   every row that already existed the instant this migration ran, and
--   defaults to FALSE for every row inserted afterward. Exempt rows are
--   never blocked, full stop — this is a one-time historical amnesty, not a
--   permanently softened gate. See is_owner_operationally_blocked() in
--   Part B for the actual check.
--
--   SCOPE NOTE / TODO: hard operational blocking is wired up for
--   driver/vehicle only (pickup_assignments INSERT + pickup_events INSERT),
--   matching the brief's TESTS list exactly. company/branch/
--   transport_company/facility restriction is REPORTING-ONLY in this phase
--   — no new enforcement trigger blocks anything for those owner_types yet
--   (accepted for this phase). TODO(CP-next): add operational enforcement
--   for those tenant-level owner_types too (e.g. block company/transport
--   company from creating new pickups/trips while restricted) — until then,
--   owner_document_status() must keep surfacing their restriction LOUDLY in
--   the UI banner so a company/transport_company/facility problem is never
--   silently invisible just because nothing server-side blocks it yet.
--
-- FILE STRUCTURE (same fix as CP1's 018 table-ordering bug):
--   PART A — schema only (tables, columns, indexes, constraints, seed
--            config data), so every table below exists before anything in
--            Part B can reference it.
--   PART B — RLS enable, policies, functions, triggers, grants.
--
-- Requires 020 (document_reviewer enum value) to have run in a prior,
-- separate transaction.
-- ═══════════════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════════════
-- PART A — SCHEMA
-- ═══════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────
-- A1. memberships: document_reviewer is tenant-less, same as admin.
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.memberships DROP CONSTRAINT one_tenant;
-- NOTE (CP5 forward-compat, unchanged from 018's comment): CP5 will add
-- super_admin/system_admin/support_agent/billing_accountant, also
-- tenant-less. When those land, widen this CHECK's role list further —
-- same add-enum-value-in-its-own-migration rule applies.
ALTER TABLE public.memberships ADD CONSTRAINT one_tenant CHECK (
  num_nonnulls(company_id, transport_company_id, facility_id) = 1
  OR (role IN ('admin', 'document_reviewer')
      AND company_id IS NULL AND transport_company_id IS NULL AND facility_id IS NULL)
);

-- ─────────────────────────────────────────────────────────────
-- A2. REQUIRED_DOCUMENTS  (global config — not tenant data)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE public.required_documents (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_type  text NOT NULL CHECK (owner_type IN
              ('company','branch','transport_company','driver','vehicle','facility')),
  doc_type    text NOT NULL,
  label_ar    text NOT NULL,
  label_en    text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_type, doc_type)
);

-- Saudi defaults from the brief.
INSERT INTO public.required_documents (owner_type, doc_type, label_ar, label_en) VALUES
  ('company',           'commercial_registration', 'السجل التجاري',                       'Commercial Registration'),
  ('company',           'vat_certificate',          'شهادة ضريبة القيمة المضافة',           'VAT Certificate'),
  ('branch',             'municipal_license',        'الرخصة البلدية',                       'Municipal License'),
  ('transport_company', 'commercial_registration',  'السجل التجاري',                       'Commercial Registration'),
  ('transport_company', 'ncwm_license',              'ترخيص الهيئة الوطنية لإدارة النفايات', 'NCWM License'),
  ('driver',             'iqama',                     'الإقامة',                              'Iqama'),
  ('driver',             'driving_license',           'رخصة القيادة',                         'Driving License'),
  ('vehicle',            'vehicle_registration',      'استمارة تسجيل المركبة',                'Vehicle Registration'),
  ('vehicle',            'ncwm_license',              'ترخيص NCWM للمركبة',                   'Vehicle NCWM License'),
  ('facility',           'commercial_registration',  'السجل التجاري',                       'Commercial Registration'),
  ('facility',           'operating_license',         'ترخيص التشغيل',                        'Operating License');

-- ─────────────────────────────────────────────────────────────
-- A3. DOCUMENTS  (polymorphic evidence, mutable ONLY by a reviewer)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE public.documents (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_type       text        NOT NULL CHECK (owner_type IN
                   ('company','branch','transport_company','driver','vehicle','facility')),
  owner_id         uuid        NOT NULL,
  doc_type         text        NOT NULL,
  file_path        text        NOT NULL,
  file_sha256      text        NOT NULL,
  issue_date       date,
  expiry_date      date,
  status           text        NOT NULL DEFAULT 'pending'
                                CHECK (status IN ('pending','verified','rejected')),
  reviewed_by      uuid        REFERENCES public.profiles(id),
  reviewed_at      timestamptz,
  reject_reason    text,
  uploaded_by      uuid        REFERENCES public.profiles(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT documents_reject_reason_check CHECK (
    status <> 'rejected' OR (reject_reason IS NOT NULL AND length(trim(reject_reason)) > 0)
  )
);

CREATE INDEX documents_owner_idx      ON public.documents(owner_type, owner_id, doc_type, created_at DESC);
CREATE INDEX documents_status_idx     ON public.documents(status);
CREATE INDEX documents_expiry_idx     ON public.documents(expiry_date) WHERE expiry_date IS NOT NULL;

-- ─────────────────────────────────────────────────────────────
-- A4. Grandfather mechanism (review decision 2). Default FALSE means
--     "enforce the gate" — so every driver/vehicle inserted AFTER this
--     migration is enforced from day one. The UPDATE immediately below runs
--     exactly once, at migration time, against exactly the set of rows that
--     existed before CP2 — nothing inserted after this point can ever match
--     it, so this is a one-time historical amnesty, not an ongoing escape
--     hatch. Not exposed as a client-settable field anywhere in Part B.
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.drivers
  ADD COLUMN compliance_exempt boolean NOT NULL DEFAULT false;
ALTER TABLE public.vehicles
  ADD COLUMN compliance_exempt boolean NOT NULL DEFAULT false;

UPDATE public.drivers  SET compliance_exempt = true;
UPDATE public.vehicles SET compliance_exempt = true;


-- ═══════════════════════════════════════════════════════════════════════════
-- PART B — RLS, functions, triggers, grants
-- ═══════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────
-- B0. Lock compliance_exempt down to the migration's one-time backfill.
--     drivers_insert/vehicles_insert AND drivers_update/vehicles_update
--     (001) are row/tenant-scoped RLS policies, not column-scoped —
--     without this, a transport owner/manager could set
--     compliance_exempt=true on a brand-new driver/vehicle at creation
--     time (or flip an existing enforced row back to exempt via a normal
--     UPDATE), permanently defeating the gate — turning "one-time
--     historical amnesty" into "an opt-out any tenant can self-grant
--     forever." On INSERT this forces false unconditionally, regardless of
--     client input — only the UPDATE in Part A ever produces true, and
--     that already ran by the time this trigger exists. On UPDATE this
--     pins the column to its OLD value — no client-initiated UPDATE can
--     ever change it either way (a genuine manual amnesty revision is a
--     service_role / SQL-console action, not an app-facing one).
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.drivers_lock_compliance_exempt()
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

CREATE TRIGGER drivers_lock_compliance_exempt_trigger
  BEFORE INSERT OR UPDATE ON public.drivers
  FOR EACH ROW EXECUTE FUNCTION public.drivers_lock_compliance_exempt();

CREATE OR REPLACE FUNCTION public.vehicles_lock_compliance_exempt()
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

CREATE TRIGGER vehicles_lock_compliance_exempt_trigger
  BEFORE INSERT OR UPDATE ON public.vehicles
  FOR EACH ROW EXECUTE FUNCTION public.vehicles_lock_compliance_exempt();

-- ─────────────────────────────────────────────────────────────
-- B1. Authorization helpers
-- ─────────────────────────────────────────────────────────────

-- May the caller UPLOAD a document for this owner? Tenant + role aware,
-- mirrors each entity's own existing write-role convention. A driver may
-- additionally self-upload their OWN driver-owner_type documents.
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
    ELSE
      RETURN false;
  END CASE;
END;
$$;

-- May the caller VIEW this owner's documents? Broader than upload — any
-- member of the same tenant (any role), or the driver themselves.
CREATE OR REPLACE FUNCTION public.can_view_document_target(p_owner_type text, p_owner_id uuid)
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
  CASE p_owner_type
    WHEN 'company' THEN
      RETURN m.company_id = p_owner_id;
    WHEN 'branch' THEN
      RETURN EXISTS (SELECT 1 FROM public.branches b WHERE b.id = p_owner_id AND b.company_id = m.company_id);
    WHEN 'transport_company' THEN
      RETURN m.transport_company_id = p_owner_id;
    WHEN 'vehicle' THEN
      RETURN EXISTS (SELECT 1 FROM public.vehicles v WHERE v.id = p_owner_id AND v.transport_company_id = m.transport_company_id);
    WHEN 'driver' THEN
      RETURN EXISTS (
        SELECT 1 FROM public.drivers d
        WHERE d.id = p_owner_id AND (d.transport_company_id = m.transport_company_id OR d.profile_id = auth.uid())
      );
    WHEN 'facility' THEN
      RETURN m.facility_id = p_owner_id;
    ELSE
      RETURN false;
  END CASE;
END;
$$;

CREATE OR REPLACE FUNCTION public.can_review_documents()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT (public.my_membership()).role IN ('document_reviewer', 'admin');
$$;

-- ─────────────────────────────────────────────────────────────
-- B2. documents: triggers
-- ─────────────────────────────────────────────────────────────

-- BEFORE INSERT: owner must exist, doc_type must be a configured required
-- document for that owner_type, and every server-trust field is forced
-- regardless of what the client sends — this is what makes "the uploader
-- can never self-verify" true even if a client tries to insert
-- status='verified' directly.
CREATE OR REPLACE FUNCTION public.documents_before_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_owner_exists boolean;
BEGIN
  SELECT CASE NEW.owner_type
    WHEN 'company'            THEN EXISTS (SELECT 1 FROM public.companies WHERE id = NEW.owner_id)
    WHEN 'branch'              THEN EXISTS (SELECT 1 FROM public.branches WHERE id = NEW.owner_id)
    WHEN 'transport_company'  THEN EXISTS (SELECT 1 FROM public.transport_companies WHERE id = NEW.owner_id)
    WHEN 'driver'              THEN EXISTS (SELECT 1 FROM public.drivers WHERE id = NEW.owner_id)
    WHEN 'vehicle'             THEN EXISTS (SELECT 1 FROM public.vehicles WHERE id = NEW.owner_id)
    WHEN 'facility'            THEN EXISTS (SELECT 1 FROM public.facilities WHERE id = NEW.owner_id)
    ELSE false
  END INTO v_owner_exists;

  IF NOT v_owner_exists THEN
    RAISE EXCEPTION 'OWNER_NOT_FOUND: % % does not exist', NEW.owner_type, NEW.owner_id
      USING ERRCODE = 'P0002';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.required_documents rd
    WHERE rd.owner_type = NEW.owner_type AND rd.doc_type = NEW.doc_type
  ) THEN
    RAISE EXCEPTION 'UNKNOWN_DOC_TYPE: % is not a configured document type for %', NEW.doc_type, NEW.owner_type
      USING ERRCODE = 'P0017';
  END IF;

  IF auth.uid() IS NOT NULL THEN
    NEW.uploaded_by := auth.uid();
  END IF;
  -- A fresh upload always starts pending review, regardless of client input —
  -- this is the actual mechanism that makes self-verification impossible.
  NEW.status        := 'pending';
  NEW.reviewed_by    := NULL;
  NEW.reviewed_at    := NULL;
  NEW.reject_reason  := NULL;

  RETURN NEW;
END;
$$;

CREATE TRIGGER documents_before_insert_trigger
  BEFORE INSERT ON public.documents
  FOR EACH ROW EXECUTE FUNCTION public.documents_before_insert();

-- BEFORE UPDATE: a reviewer may change status/reviewed_by/reviewed_at/
-- reject_reason ONLY — every other column (including the file itself) is
-- immutable once uploaded. Re-review of an already-reviewed row is
-- rejected — a failed/renewed document is a NEW upload (new row), keeping
-- the review history intact.
CREATE OR REPLACE FUNCTION public.documents_before_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT public.can_review_documents() THEN
    RAISE EXCEPTION 'REVIEW_ONLY: only a document_reviewer or admin may update a document'
      USING ERRCODE = 'P0018';
  END IF;

  IF NEW.owner_type   IS DISTINCT FROM OLD.owner_type
     OR NEW.owner_id     IS DISTINCT FROM OLD.owner_id
     OR NEW.doc_type     IS DISTINCT FROM OLD.doc_type
     OR NEW.file_path    IS DISTINCT FROM OLD.file_path
     OR NEW.file_sha256  IS DISTINCT FROM OLD.file_sha256
     OR NEW.issue_date   IS DISTINCT FROM OLD.issue_date
     OR NEW.expiry_date  IS DISTINCT FROM OLD.expiry_date
     OR NEW.uploaded_by  IS DISTINCT FROM OLD.uploaded_by
     OR NEW.created_at   IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION 'REVIEW_FIELDS_ONLY: a reviewer may only change status/reviewed_by/reviewed_at/reject_reason'
      USING ERRCODE = 'P0020';
  END IF;

  IF OLD.status <> 'pending' THEN
    RAISE EXCEPTION 'ALREADY_REVIEWED: % has already been reviewed — re-upload to try again', OLD.id
      USING ERRCODE = 'P0021';
  END IF;

  IF NEW.status NOT IN ('verified','rejected') THEN
    RAISE EXCEPTION 'INVALID_REVIEW_STATUS: status must become verified or rejected'
      USING ERRCODE = 'P0022';
  END IF;

  -- Belt-and-suspenders: structurally the uploader can never pass
  -- can_review_documents() (document_reviewer is tenant-less, so it can
  -- never also satisfy owns_document_target()'s tenant match) — this catches
  -- the one edge case where roles could coincide: an admin who uploaded on a
  -- tenant's behalf reviewing their own upload.
  IF NEW.uploaded_by IS NOT NULL AND NEW.uploaded_by = auth.uid() THEN
    RAISE EXCEPTION 'NO_SELF_VERIFY: cannot review your own uploaded document'
      USING ERRCODE = 'P0019';
  END IF;

  NEW.reviewed_by := auth.uid();
  NEW.reviewed_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER documents_before_update_trigger
  BEFORE UPDATE ON public.documents
  FOR EACH ROW EXECUTE FUNCTION public.documents_before_update();

-- ─────────────────────────────────────────────────────────────
-- B3. documents / required_documents: RLS + grants
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.required_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY documents_select ON public.documents
  FOR SELECT TO authenticated
  USING (public.can_review_documents() OR public.can_view_document_target(owner_type, owner_id));

CREATE POLICY documents_insert ON public.documents
  FOR INSERT TO authenticated
  WITH CHECK (public.owns_document_target(owner_type, owner_id) AND uploaded_by = auth.uid());

CREATE POLICY documents_update ON public.documents
  FOR UPDATE TO authenticated
  USING (public.can_review_documents());

GRANT SELECT, INSERT, UPDATE ON public.documents TO authenticated;
GRANT ALL                     ON public.documents TO service_role;
-- No DELETE for authenticated — review history is permanent (mirrors the
-- rest of this schema's evidence tables); a bad upload is superseded by a
-- new one, not erased.

CREATE POLICY required_documents_select ON public.required_documents
  FOR SELECT TO authenticated
  USING (true);
-- INSERT/UPDATE: service_role / admin console only (global config, not tenant data).

GRANT SELECT ON public.required_documents TO authenticated;
GRANT ALL    ON public.required_documents TO service_role;

-- ─────────────────────────────────────────────────────────────
-- B4. owner_document_status — the completion/activation computation
-- ─────────────────────────────────────────────────────────────

-- Internal, unauthorized computation — NOT for direct client use (see the
-- REVOKE below). Used by (a) the public wrapper right after it, which adds
-- the authorization check, and (b) is_owner_operationally_blocked(), called
-- from trigger contexts where the "caller" may be service_role (auth.uid()
-- NULL) during setup/tests — routing those through an authorization check
-- would break every existing service_role-driven pickup_event insert in the
-- test suite, which is exactly the kind of blast radius this migration is
-- designed to avoid.
--
-- SCALING SEAM (review decision 1 — do not optimize now, just don't forget
-- it): this recomputes from `documents` + `required_documents` on every
-- call. At hundreds of drivers/vehicles this becomes a per-row function
-- call on list views (e.g. a fleet table rendering completion_pct for every
-- driver) and a document lookup on every single pickup_assignments/
-- pickup_events INSERT. Fine at CP2's scale; when it bites, revisit with
-- either a trigger-maintained cache column (recomputed by a trigger on
-- public.documents INSERT/UPDATE, same pattern as trips.reconciled_* in
-- migration 018) or a materialized view refreshed on the same triggers.
-- Do NOT reach for that until it's actually measured as slow.
CREATE OR REPLACE FUNCTION public._owner_document_status_unsafe(p_owner_type text, p_owner_id uuid)
RETURNS TABLE (
  completion_pct        int,
  activation_status      text,
  missing_doc_types      text[],
  expired_doc_types      text[],
  unverified_doc_types  text[],
  expiring_soon          jsonb
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_required_count  int;
  v_satisfied_count int := 0;
  v_missing         text[] := '{}';
  v_expired         text[] := '{}';
  v_unverified      text[] := '{}';
  v_expiring        jsonb  := '[]'::jsonb;
  v_has_rejected    boolean := false;
  r                 record;
  v_days            int;
  v_level           text;
BEGIN
  SELECT count(*) INTO v_required_count
  FROM public.required_documents WHERE owner_type = p_owner_type;

  IF v_required_count = 0 THEN
    RETURN QUERY SELECT 100, 'active'::text, v_missing, v_expired, v_unverified, v_expiring;
    RETURN;
  END IF;

  FOR r IN
    SELECT rd.doc_type, d.status, d.expiry_date
    FROM public.required_documents rd
    LEFT JOIN LATERAL (
      SELECT doc.status, doc.expiry_date
      FROM public.documents doc
      WHERE doc.owner_type = p_owner_type
        AND doc.owner_id = p_owner_id
        AND doc.doc_type = rd.doc_type
      ORDER BY doc.created_at DESC
      LIMIT 1
    ) d ON true
    WHERE rd.owner_type = p_owner_type
  LOOP
    IF r.status IS NULL THEN
      v_missing := v_missing || r.doc_type;
    ELSIF r.expiry_date IS NOT NULL AND r.expiry_date < CURRENT_DATE THEN
      v_expired := v_expired || r.doc_type;
    ELSIF r.status <> 'verified' THEN
      v_unverified := v_unverified || r.doc_type;
      IF r.status = 'rejected' THEN
        v_has_rejected := true;
      END IF;
    ELSE
      v_satisfied_count := v_satisfied_count + 1;
      IF r.expiry_date IS NOT NULL THEN
        v_days := r.expiry_date - CURRENT_DATE;
        IF v_days <= 30 THEN
          v_level := CASE WHEN v_days <= 7 THEN 'critical' WHEN v_days <= 15 THEN 'high' ELSE 'medium' END;
          v_expiring := v_expiring || jsonb_build_object(
            'doc_type', r.doc_type, 'expiry_date', r.expiry_date,
            'days_remaining', v_days, 'level', v_level
          );
        END IF;
      END IF;
    END IF;
  END LOOP;

  RETURN QUERY SELECT
    ROUND(100.0 * v_satisfied_count / v_required_count)::int,
    CASE
      WHEN v_satisfied_count = v_required_count THEN 'active'
      WHEN array_length(v_expired, 1) > 0 OR v_has_rejected THEN 'restricted'
      ELSE 'onboarding'
    END,
    v_missing, v_expired, v_unverified, v_expiring;
END;
$$;

REVOKE EXECUTE ON FUNCTION public._owner_document_status_unsafe(text, uuid) FROM PUBLIC, authenticated, anon;

-- Public-facing wrapper: same computation, WITH an authorization check —
-- safe to expose directly to any authenticated client.
CREATE OR REPLACE FUNCTION public.owner_document_status(p_owner_type text, p_owner_id uuid)
RETURNS TABLE (
  completion_pct        int,
  activation_status      text,
  missing_doc_types      text[],
  expired_doc_types      text[],
  unverified_doc_types  text[],
  expiring_soon          jsonb
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT (public.can_view_document_target(p_owner_type, p_owner_id) OR public.can_review_documents()) THEN
    RAISE EXCEPTION 'ACCESS_DENIED: not authorized to view % % document status', p_owner_type, p_owner_id
      USING ERRCODE = 'P0025';
  END IF;
  RETURN QUERY SELECT * FROM public._owner_document_status_unsafe(p_owner_type, p_owner_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.owner_document_status(text, uuid) TO authenticated;

-- The operational gate. Blocks on "not active" (both 'onboarding' AND
-- 'restricted') for driver/vehicle — see the file header for why that's
-- safe: compliance_exempt grandfathers every pre-CP2 row, so this only ever
-- bites a driver/vehicle created after this migration landed. For any other
-- owner_type it always returns false (no compliance_exempt column exists
-- there, and — per the SCOPE NOTE / TODO above — tenant-level owner_types
-- have no operational enforcement in this phase at all).
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
  ELSE
    RETURN false;
  END IF;

  -- Row not found is handled by the caller's own FK-consistency checks
  -- (pickup_assignments/pickup_events already validate driver_id/vehicle_id
  -- exist and belong to the right transport_company before this runs) —
  -- here, "not found" just means nothing to block on.
  IF v_exempt IS NULL OR v_exempt THEN
    RETURN false;
  END IF;

  SELECT activation_status INTO v_status
  FROM public._owner_document_status_unsafe(p_owner_type, p_owner_id);
  RETURN v_status IS DISTINCT FROM 'active';
END;
$$;

REVOKE EXECUTE ON FUNCTION public.is_owner_operationally_blocked(text, uuid) FROM PUBLIC, authenticated, anon;

-- ─────────────────────────────────────────────────────────────
-- B5. Operational enforcement: a non-exempt driver/vehicle that isn't
--     ACTIVE (onboarding OR restricted) cannot be scheduled
--     (pickup_assignments) or complete a pickup (pickup_events).
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.pickup_assignments_document_gate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
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

CREATE TRIGGER pickup_assignments_document_gate_trigger
  BEFORE INSERT ON public.pickup_assignments
  FOR EACH ROW EXECUTE FUNCTION public.pickup_assignments_document_gate();

-- pickup_events_before_insert: replaces 018's version in place — all prior
-- logic (branch/driver/vehicle/trip FK checks, geofence, QR, risk engine)
-- kept verbatim, only step 4c is new.
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

-- ═══════════════════════════════════════════════════════════════════════════
-- B6. STORAGE: compliance-documents bucket (private, tenant-scoped)
--     Path convention: {owner_type}/{owner_id}/{doc_type}-{timestamp}.{ext}
-- ═══════════════════════════════════════════════════════════════════════════
INSERT INTO storage.buckets (id, name, public)
VALUES ('compliance-documents', 'compliance-documents', false)
ON CONFLICT (id) DO NOTHING;

-- Text-based owner_id comparison (not a uuid cast) so a malformed path
-- fails closed with "access denied" rather than a Postgres cast error —
-- mirrors storage_weighbridge_prefix_allowed's pattern (018).
CREATE OR REPLACE FUNCTION public.storage_document_prefix_allowed(p_owner_type text, p_owner_id_text text)
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
  IF m.role = 'admin' OR m.role = 'document_reviewer' THEN
    RETURN true;
  END IF;

  CASE p_owner_type
    WHEN 'company' THEN
      RETURN m.company_id::text = p_owner_id_text;
    WHEN 'branch' THEN
      RETURN EXISTS (SELECT 1 FROM public.branches b WHERE b.id::text = p_owner_id_text AND b.company_id = m.company_id);
    WHEN 'transport_company' THEN
      RETURN m.transport_company_id::text = p_owner_id_text;
    WHEN 'vehicle' THEN
      RETURN EXISTS (SELECT 1 FROM public.vehicles v WHERE v.id::text = p_owner_id_text AND v.transport_company_id = m.transport_company_id);
    WHEN 'driver' THEN
      RETURN EXISTS (
        SELECT 1 FROM public.drivers d
        WHERE d.id::text = p_owner_id_text AND (d.transport_company_id = m.transport_company_id OR d.profile_id = auth.uid())
      );
    WHEN 'facility' THEN
      RETURN m.facility_id::text = p_owner_id_text;
    ELSE
      RETURN false;
  END CASE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.storage_document_prefix_allowed(text, text) TO authenticated;

CREATE POLICY compliance_documents_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'compliance-documents'
    AND public.storage_document_prefix_allowed((storage.foldername(name))[1], (storage.foldername(name))[2])
  );

CREATE POLICY compliance_documents_select ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'compliance-documents'
    AND public.storage_document_prefix_allowed((storage.foldername(name))[1], (storage.foldername(name))[2])
  );

-- Append-only (no UPDATE/DELETE) is already enforced bucket-agnostically by
-- migration 005's evidence_no_update / evidence_no_delete policies —
-- compliance-documents inherits that automatically, matching documents
-- itself never allowing the file to change after upload.

-- ═══════════════════════════════════════════════════════════════════════════
-- END OF MIGRATION 021
-- ═══════════════════════════════════════════════════════════════════════════
