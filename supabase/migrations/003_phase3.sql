-- ═══════════════════════════════════════════════════════════════════════════
-- Tadweer360 – Phase 3 Migration: Assignments, Alerts, Notifications
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Adds three new mutable tables (RLS-scoped, tenant-isolated):
--   • pickup_assignments    – dispatcher schedules a driver+vehicle for a branch
--   • alert_acknowledgements – per-company acknowledgement of a derived alert
--   • notifications          – per-user in-app notification feed
--
-- IMPORTANT schema reality (differs from the generic Phase-3 brief):
--   • public.memberships uses column `user_id` (NOT profile_id).
--   • member_role enum = owner | manager | driver | dispatcher | admin.
--   • A company manager's membership has company_id set, transport_company_id NULL.
--   • drivers/vehicles belong to a transport_company, not a company.
--
-- All policies reuse the existing SECURITY DEFINER helper public.my_membership()
-- (defined in 001) for consistency and to avoid recursive RLS on memberships.
-- That helper returns the caller's single membership row.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────
-- 0. BRANCH soft-delete support
--    branches had no lifecycle column. Add `status` so deleteBranch() can do a
--    soft delete (status='inactive') instead of a hard DELETE (which would
--    orphan pickup_events / assignments via FK). Default keeps existing rows active.
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.branches
  ADD COLUMN status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','inactive'));

-- ─────────────────────────────────────────────────────────────
-- 1. PICKUP ASSIGNMENTS  (mutable — managers/dispatchers manage; drivers act)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE public.pickup_assignments (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid        NOT NULL REFERENCES public.companies(id),
  branch_id       uuid        NOT NULL REFERENCES public.branches(id),
  driver_id       uuid        NOT NULL REFERENCES public.drivers(id),
  vehicle_id      uuid        NOT NULL REFERENCES public.vehicles(id),
  scheduled_at    timestamptz NOT NULL,
  status          text        NOT NULL DEFAULT 'pending'
                              CHECK (status IN ('pending','accepted','in_progress','completed','cancelled')),
  pickup_event_id uuid        REFERENCES public.pickup_events(id),  -- set on completion
  notes           text,
  created_by      uuid        REFERENCES public.profiles(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX pickup_assignments_company_idx   ON public.pickup_assignments(company_id, scheduled_at DESC);
CREATE INDEX pickup_assignments_driver_idx    ON public.pickup_assignments(driver_id, scheduled_at DESC);
CREATE INDEX pickup_assignments_branch_idx    ON public.pickup_assignments(branch_id);
CREATE INDEX pickup_assignments_status_idx    ON public.pickup_assignments(status);

ALTER TABLE public.pickup_assignments ENABLE ROW LEVEL SECURITY;

-- SELECT: company members of the same company OR drivers in the assigned
-- transport company (resolved via the driver row's transport_company_id) OR admin.
CREATE POLICY pickup_assignments_select ON public.pickup_assignments FOR SELECT
  TO authenticated
  USING (
    company_id = (public.my_membership()).company_id
    OR (public.my_membership()).role = 'admin'
    OR driver_id IN (
         SELECT d.id FROM public.drivers d
         WHERE d.transport_company_id = (public.my_membership()).transport_company_id
       )
  );

-- INSERT: company owner/manager/dispatcher for their own company.
CREATE POLICY pickup_assignments_insert ON public.pickup_assignments FOR INSERT
  TO authenticated
  WITH CHECK (
    company_id = (public.my_membership()).company_id
    AND (public.my_membership()).role IN ('owner','manager','dispatcher')
  );

-- UPDATE: company owner/manager/dispatcher (status transitions, completion link)
-- OR a driver in the assigned transport company (accept/start/complete their work).
CREATE POLICY pickup_assignments_update ON public.pickup_assignments FOR UPDATE
  TO authenticated
  USING (
    (
      company_id = (public.my_membership()).company_id
      AND (public.my_membership()).role IN ('owner','manager','dispatcher')
    )
    OR driver_id IN (
         SELECT d.id FROM public.drivers d
         WHERE d.transport_company_id = (public.my_membership()).transport_company_id
       )
  );

-- ─────────────────────────────────────────────────────────────
-- updated_at trigger
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER pickup_assignments_set_updated_at
  BEFORE UPDATE ON public.pickup_assignments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─────────────────────────────────────────────────────────────
-- 2. ALERT ACKNOWLEDGEMENTS  (per-company, dedup by alert_key)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE public.alert_acknowledgements (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid        NOT NULL REFERENCES public.companies(id),
  alert_key       text        NOT NULL,   -- e.g. "driver_expiry:<driver_id>"
  acknowledged_by uuid        REFERENCES public.profiles(id),
  acknowledged_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, alert_key)
);
CREATE INDEX alert_acks_company_idx ON public.alert_acknowledgements(company_id);

ALTER TABLE public.alert_acknowledgements ENABLE ROW LEVEL SECURITY;

CREATE POLICY alert_acks_select ON public.alert_acknowledgements FOR SELECT
  TO authenticated
  USING (
    company_id = (public.my_membership()).company_id
    OR (public.my_membership()).role = 'admin'
  );

CREATE POLICY alert_acks_insert ON public.alert_acknowledgements FOR INSERT
  TO authenticated
  WITH CHECK (
    company_id = (public.my_membership()).company_id
  );

-- ─────────────────────────────────────────────────────────────
-- 3. NOTIFICATIONS  (per-user in-app feed)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE public.notifications (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id  uuid        NOT NULL REFERENCES public.profiles(id),
  company_id  uuid        REFERENCES public.companies(id),
  title_ar    text        NOT NULL,
  title_en    text        NOT NULL,
  body_ar     text,
  body_en     text,
  link        text,
  is_read     boolean     NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_profile_idx ON public.notifications(profile_id, created_at DESC);
CREATE INDEX notifications_unread_idx  ON public.notifications(profile_id) WHERE is_read = false;

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- Own notifications only (read + mark-read). INSERT also restricted to self so a
-- client cannot spam another user; server/service_role inserts cross-user rows.
CREATE POLICY notifications_select ON public.notifications FOR SELECT
  TO authenticated
  USING (profile_id = auth.uid());

CREATE POLICY notifications_insert ON public.notifications FOR INSERT
  TO authenticated
  WITH CHECK (profile_id = auth.uid());

CREATE POLICY notifications_update ON public.notifications FOR UPDATE
  TO authenticated
  USING (profile_id = auth.uid())
  WITH CHECK (profile_id = auth.uid());

-- ═══════════════════════════════════════════════════════════════════════════
-- GRANTS
--   service_role already has ALL via the schema-wide grant in 001, but new
--   tables created after that grant need explicit grants. Add them for both.
-- ═══════════════════════════════════════════════════════════════════════════
GRANT SELECT, INSERT, UPDATE ON public.pickup_assignments      TO authenticated;
GRANT SELECT, INSERT         ON public.alert_acknowledgements  TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.notifications           TO authenticated;

GRANT ALL ON public.pickup_assignments     TO service_role;
GRANT ALL ON public.alert_acknowledgements TO service_role;
GRANT ALL ON public.notifications          TO service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- END OF MIGRATION 003
-- ═══════════════════════════════════════════════════════════════════════════
