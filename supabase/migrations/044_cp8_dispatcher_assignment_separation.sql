-- ═══════════════════════════════════════════════════════════════════════════
-- Sanad 360 – Migration 044: Separation of duties — company REQUESTS a
-- pickup, transport dispatcher ASSIGNS its own driver + vehicle
-- ═══════════════════════════════════════════════════════════════════════════
-- PROBLEM (confirmed by direct investigation, not assumed): pickup_assignments
-- .driver_id/.vehicle_id are NOT NULL today and are set by the COMPANY at
-- request time (PickupSchedulePage.tsx reads a cross-tenant pool of the
-- linked transporter's drivers/vehicles via getDriversAndVehiclesForCompany()
-- and lets the company pick). RLS's own pickup_assignments_insert (003) WITH
-- CHECK never restricted which driver_id/vehicle_id a company caller may set
-- — only company_id. The transport side has no path at all to assign
-- driver/vehicle onto a company-originated row: 019's own
-- pickup_assignments_trip_link_guard() trigger explicitly forbids a
-- transport-staff UPDATE from touching anything but trip_id.
--
-- FIX: pickup_assignments gets a new initial status 'requested' — a row in
-- this state has NO driver/vehicle yet. The company may only ever create
-- (and edit/cancel) 'requested' rows; it can never set driver_id/vehicle_id,
-- enforced at BOTH the RLS WITH CHECK (INSERT) and the trigger (UPDATE, RLS
-- alone cannot diff OLD vs NEW columns). A linked transport company's
-- owner/manager/dispatcher may then UPDATE a 'requested' row to set its OWN
-- driver + vehicle, transitioning it to 'pending' — carved as a narrow
-- exception into 019's guard trigger, which must continue to forbid the
-- transport side from touching any column outside
-- {driver_id, vehicle_id, status (requested->pending only), trip_id}.
--
-- 011 (dispatcher creates a full row from scratch, its own driver/vehicle,
-- for a linked company) is UNCHANGED — that path never produces a
-- 'requested' row (driver/vehicle are set at INSERT), so none of the new
-- machinery applies to it. Confirmed: its own WITH CHECK's EXISTS on drivers
-- already requires driver_id to be NOT NULL to match, so it cannot
-- accidentally create a 'requested'-shaped row.
--
-- SCOPE NOTE: two gaps were found while building this that are NOT explicitly
-- one of the 8 requested items, but are necessary for the feature to
-- function at all — flagged separately in Parts F and G below, not folded
-- silently into the numbered parts, so they can be approved/rejected on
-- their own:
--   F. pickup_assignments_select needs a new arm — without it, a dispatcher
--      has no way to ever SEE a linked company's unassigned 'requested' rows
--      (the existing driver-fleet SELECT arm can never match a NULL
--      driver_id), so there would be nothing to discover and assign.
--   G. notify_assignment_created() only fires AFTER INSERT — in the new
--      flow the driver isn't known until the later assign-UPDATE, so today's
--      trigger would never notify anyone in practice. Extended to also fire
--      on the UPDATE that sets driver_id.
--
-- RLS OR-COMBINATION NOTE (for the reviewer, not a gap): Postgres combines
-- multiple permissive policies' USING clauses with OR, and separately
-- combines all applicable WITH CHECK clauses with OR — the pairing is not
-- per-policy. In principle 011's pre-existing pickup_assignments_update_
-- transport policy's default WITH CHECK (identical text to its own USING)
-- could independently be satisfied by a NEW row whose driver_id lands in the
-- caller's own fleet, even though that policy's own USING (evaluated against
-- OLD) never admits a 'requested' row (OLD.driver_id is NULL, so its EXISTS
-- can't match). This is not a real bypass: the BEFORE trigger below is
-- unconditional (runs regardless of which policy's USING/WITH CHECK
-- happened to pass) and is the sole authoritative gate for the column-diff,
-- company-link, and driver+vehicle fleet-ownership checks — the exact same
-- layering 019 already relies on for its own trip_id-only restriction.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────
-- A. Schema: driver_id/vehicle_id -> NULLABLE; 'requested' added to the
--    status lifecycle; a new CHECK ties driver/vehicle presence to status.
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.pickup_assignments ALTER COLUMN driver_id  DROP NOT NULL;
ALTER TABLE public.pickup_assignments ALTER COLUMN vehicle_id DROP NOT NULL;

ALTER TABLE public.pickup_assignments
  DROP CONSTRAINT pickup_assignments_status_check;
ALTER TABLE public.pickup_assignments
  ADD CONSTRAINT pickup_assignments_status_check
    CHECK (status = ANY (ARRAY['requested','pending','accepted','in_progress','completed','cancelled']));

-- 'requested' rows may never carry a driver/vehicle; every other live status
-- (pending/accepted/in_progress/completed) must carry both; 'cancelled' may
-- be either (a request can be cancelled before OR after assignment).
ALTER TABLE public.pickup_assignments
  ADD CONSTRAINT pickup_assignments_driver_vehicle_status_check
    CHECK (
      (status = 'requested' AND driver_id IS NULL AND vehicle_id IS NULL)
      OR (status IN ('pending','accepted','in_progress','completed')
          AND driver_id IS NOT NULL AND vehicle_id IS NOT NULL)
      OR (status = 'cancelled')
    );

-- NOTE for the follow-up UI work (not done here): the column DEFAULT for
-- `status` stays 'pending' (unchanged) — 011's dispatcher-insert-from-scratch
-- relies on that default and always supplies driver_id/vehicle_id, so it's
-- unaffected. The company's own createAssignment() call MUST be updated to
-- explicitly pass status: 'requested' once the UI stops sending driver_id/
-- vehicle_id — leaving the DEFAULT at 'pending' means an insert that omits
-- both driver/vehicle AND status will now fail the CHECK constraint above
-- (fail-closed), not silently succeed in the wrong shape.

-- ─────────────────────────────────────────────────────────────
-- B. Company INSERT (003, pickup_assignments_insert): must now REQUIRE
--    driver_id/vehicle_id NULL and status='requested' — the company creates
--    requests only, it can never choose who does the pickup.
-- ─────────────────────────────────────────────────────────────
-- --- diff vs live ---
--    WITH CHECK (
--      company_id = (public.my_membership()).company_id
--      AND (public.my_membership()).role IN ('owner','manager','dispatcher')
-- +    AND driver_id IS NULL
-- +    AND vehicle_id IS NULL
-- +    AND status = 'requested'
--    )
-- --- end diff ---
DROP POLICY IF EXISTS pickup_assignments_insert ON public.pickup_assignments;
CREATE POLICY pickup_assignments_insert ON public.pickup_assignments FOR INSERT
  TO authenticated
  WITH CHECK (
    company_id = (public.my_membership()).company_id
    AND (public.my_membership()).role IN ('owner','manager','dispatcher')
    AND driver_id IS NULL
    AND vehicle_id IS NULL
    AND status = 'requested'
  );

-- ─────────────────────────────────────────────────────────────
-- C. NEW transport-side assignment RLS: lets a linked transporter's staff
--    reach a 'requested' row at all. Necessary because BOTH existing
--    transport UPDATE policies (011's pickup_assignments_update_transport,
--    019's pickup_assignments_update_transport_trip_link) gate USING on
--    "driver_id already belongs to my fleet" — which can never be true while
--    driver_id is still NULL. Company-link mirrors 011's own INSERT check
--    exactly; WITH CHECK additionally requires the assigned driver AND
--    vehicle (011 only ever checked the driver) to belong to the caller's
--    own fleet, status to land on exactly 'pending', and both fields
--    non-null. This is RLS-layer defense-in-depth — the trigger in Part D is
--    the authoritative gate (see the OR-combination note above).
-- ─────────────────────────────────────────────────────────────
CREATE POLICY pickup_assignments_update_transport_assign ON public.pickup_assignments
  FOR UPDATE TO authenticated
  USING (
    (public.my_membership()).role IN ('owner','manager','dispatcher')
    AND (public.my_membership()).transport_company_id IS NOT NULL
    AND status = 'requested'
    AND EXISTS (
      SELECT 1 FROM public.company_transporters ct
      WHERE ct.status = 'active'
        AND ct.company_id = pickup_assignments.company_id
        AND ct.transport_company_id = (public.my_membership()).transport_company_id
    )
  )
  WITH CHECK (
    (public.my_membership()).role IN ('owner','manager','dispatcher')
    AND (public.my_membership()).transport_company_id IS NOT NULL
    AND status = 'pending'
    AND driver_id IS NOT NULL
    AND vehicle_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.drivers d
      WHERE d.id = pickup_assignments.driver_id
        AND d.transport_company_id = (public.my_membership()).transport_company_id
    )
    AND EXISTS (
      SELECT 1 FROM public.vehicles v
      WHERE v.id = pickup_assignments.vehicle_id
        AND v.transport_company_id = (public.my_membership()).transport_company_id
    )
  );

-- ─────────────────────────────────────────────────────────────
-- D. pickup_assignments_trip_link_guard() — DIFF vs live (shown in full
--    below; every line of the pre-existing trip-linking logic at the bottom
--    of the function is byte-for-byte unchanged):
--
--    + a new v_is_company_staff_path detection, and a new guard: a
--      company-staff caller's UPDATE may never change driver_id/vehicle_id
--      (item 5 — RLS's pickup_assignments_update policy has no per-column
--      WITH CHECK today and none is added; this trigger is the guard).
--    + a new v_is_dispatcher_assign detection (OLD.status='requested' AND
--      NEW.driver_id/vehicle_id both becoming non-null, transport-staff
--      caller): when true, the transport-staff branch now allows
--      driver_id/vehicle_id/status(->'pending') to change (in addition to
--      trip_id, already allowed), re-validates company-link + BOTH driver
--      and vehicle fleet-ownership, and continues to forbid every other
--      column exactly as before. When false, the existing
--      trip-id-only-for-transport-staff branch is untouched.
-- --- diff ---
--    v_is_transport_staff_path boolean;
-- +  v_is_company_staff_path   boolean;
-- +  v_is_dispatcher_assign    boolean;
--    BEGIN
--      v_is_transport_staff_path :=
--        (public.my_membership()).role IN ('owner','manager','dispatcher')
--        AND (public.my_membership()).transport_company_id IS NOT NULL;
-- +
-- +    v_is_company_staff_path :=
-- +      (public.my_membership()).role IN ('owner','manager','dispatcher')
-- +      AND (public.my_membership()).company_id IS NOT NULL;
-- +
-- +    v_is_dispatcher_assign :=
-- +      TG_OP = 'UPDATE'
-- +      AND v_is_transport_staff_path
-- +      AND OLD.status = 'requested'
-- +      AND NEW.driver_id IS NOT NULL AND NEW.vehicle_id IS NOT NULL;
--
--      IF TG_OP = 'UPDATE' AND v_is_transport_staff_path THEN
-- +      IF v_is_dispatcher_assign THEN
-- +        IF NEW.company_id        IS DISTINCT FROM OLD.company_id
-- +           OR NEW.branch_id      IS DISTINCT FROM OLD.branch_id
-- +           OR NEW.scheduled_at   IS DISTINCT FROM OLD.scheduled_at
-- +           OR NEW.status         IS DISTINCT FROM 'pending'
-- +           OR NEW.recurrence     IS DISTINCT FROM OLD.recurrence
-- +           OR NEW.recurrence_until IS DISTINCT FROM OLD.recurrence_until
-- +           OR NEW.pickup_event_id  IS DISTINCT FROM OLD.pickup_event_id
-- +           OR NEW.notes          IS DISTINCT FROM OLD.notes
-- +           OR NEW.created_by     IS DISTINCT FROM OLD.created_by
-- +        THEN
-- +          RAISE EXCEPTION 'TRANSPORT_MAY_ONLY_ASSIGN_OR_LINK_TRIP: ...' USING ERRCODE = 'P0016';
-- +        END IF;
-- +
-- +        IF NOT EXISTS ( ... company_transporters active link ... ) THEN
-- +          RAISE EXCEPTION 'ASSIGN_COMPANY_NOT_LINKED: ...' USING ERRCODE = 'P0028';
-- +        END IF;
-- +
-- +        SELECT transport_company_id INTO v_driver_tc FROM public.drivers WHERE id = NEW.driver_id;
-- +        IF v_driver_tc IS DISTINCT FROM (public.my_membership()).transport_company_id THEN
-- +          RAISE EXCEPTION 'ASSIGN_DRIVER_NOT_OWN_FLEET: ...' USING ERRCODE = 'P0029';
-- +        END IF;
-- +
-- +        SELECT transport_company_id INTO v_vehicle_tc FROM public.vehicles WHERE id = NEW.vehicle_id;
-- +        IF v_vehicle_tc IS DISTINCT FROM (public.my_membership()).transport_company_id THEN
-- +          RAISE EXCEPTION 'ASSIGN_VEHICLE_NOT_OWN_FLEET: ...' USING ERRCODE = 'P0031';
-- +        END IF;
-- +      ELSE
--          -- existing trip-id-only body, unchanged, now nested under ELSE
--          IF NEW.company_id ... THEN RAISE EXCEPTION 'TRANSPORT_MAY_ONLY_LINK_TRIP: ...' USING ERRCODE = 'P0016'; END IF;
-- +      END IF;
--      END IF;
-- +
-- +    IF TG_OP = 'UPDATE' AND v_is_company_staff_path THEN
-- +      IF NEW.driver_id IS DISTINCT FROM OLD.driver_id OR NEW.vehicle_id IS DISTINCT FROM OLD.vehicle_id THEN
-- +        RAISE EXCEPTION 'COMPANY_MAY_NOT_ASSIGN: ...' USING ERRCODE = 'P0032';
-- +      END IF;
-- +    END IF;
--
--      -- unchanged tail: trip_id NULL/unchanged short-circuit, trip lookup,
--      -- TRIP_LINK_TRANSPORT_ONLY (P0014), TRIP_DRIVER_MISMATCH (P0015).
-- --- end diff ---
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.pickup_assignments_trip_link_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_trip                     public.trips%ROWTYPE;
  v_driver_tc                uuid;
  v_vehicle_tc                uuid;
  v_is_transport_staff_path  boolean;
  v_is_company_staff_path    boolean;
  v_is_dispatcher_assign     boolean;
BEGIN
  v_is_transport_staff_path :=
    (public.my_membership()).role IN ('owner','manager','dispatcher')
    AND (public.my_membership()).transport_company_id IS NOT NULL;

  v_is_company_staff_path :=
    (public.my_membership()).role IN ('owner','manager','dispatcher')
    AND (public.my_membership()).company_id IS NOT NULL;

  -- (044) The new dispatcher-assign transition: a 'requested' row (no
  -- driver/vehicle yet) is being turned into a 'pending' assignment.
  -- Detected on UPDATE only — a transport caller never reaches this row via
  -- INSERT (that's 011's own, unchanged, from-scratch INSERT policy, which
  -- always supplies driver_id/vehicle_id and so never produces a
  -- 'requested' row in the first place).
  v_is_dispatcher_assign :=
    TG_OP = 'UPDATE'
    AND v_is_transport_staff_path
    AND OLD.status = 'requested'
    AND NEW.driver_id IS NOT NULL AND NEW.vehicle_id IS NOT NULL;

  IF TG_OP = 'UPDATE' AND v_is_transport_staff_path THEN
    IF v_is_dispatcher_assign THEN
      -- Assigning: only driver_id, vehicle_id, status (requested->pending),
      -- and trip_id (a dispatcher may assign and trip-link in the same
      -- call) may change. Every other column must stay exactly as the
      -- company left it.
      IF NEW.company_id        IS DISTINCT FROM OLD.company_id
         OR NEW.branch_id      IS DISTINCT FROM OLD.branch_id
         OR NEW.scheduled_at   IS DISTINCT FROM OLD.scheduled_at
         OR NEW.status         IS DISTINCT FROM 'pending'
         OR NEW.recurrence     IS DISTINCT FROM OLD.recurrence
         OR NEW.recurrence_until IS DISTINCT FROM OLD.recurrence_until
         OR NEW.pickup_event_id  IS DISTINCT FROM OLD.pickup_event_id
         OR NEW.notes          IS DISTINCT FROM OLD.notes
         OR NEW.created_by     IS DISTINCT FROM OLD.created_by
      THEN
        RAISE EXCEPTION 'TRANSPORT_MAY_ONLY_ASSIGN_OR_LINK_TRIP: a transport-side caller assigning a driver/vehicle may only set driver_id, vehicle_id, status (requested->pending), and trip_id on a pickup_assignments row'
          USING ERRCODE = 'P0016';
      END IF;

      -- The transporter must be ACTIVELY linked to the requesting company
      -- (mirrors 011's own INSERT check exactly).
      IF NOT EXISTS (
        SELECT 1 FROM public.company_transporters ct
        WHERE ct.status = 'active'
          AND ct.company_id = NEW.company_id
          AND ct.transport_company_id = (public.my_membership()).transport_company_id
      ) THEN
        RAISE EXCEPTION 'ASSIGN_COMPANY_NOT_LINKED: transport_company % is not actively linked to company %',
          (public.my_membership()).transport_company_id, NEW.company_id USING ERRCODE = 'P0028';
      END IF;

      -- The assigned driver AND vehicle must belong to the CALLER's own
      -- fleet — never another transporter's (011 only ever validated the
      -- driver at INSERT time; both are validated here).
      SELECT transport_company_id INTO v_driver_tc FROM public.drivers WHERE id = NEW.driver_id;
      IF v_driver_tc IS DISTINCT FROM (public.my_membership()).transport_company_id THEN
        RAISE EXCEPTION 'ASSIGN_DRIVER_NOT_OWN_FLEET: driver % does not belong to the caller''s own transport company', NEW.driver_id
          USING ERRCODE = 'P0029';
      END IF;

      SELECT transport_company_id INTO v_vehicle_tc FROM public.vehicles WHERE id = NEW.vehicle_id;
      IF v_vehicle_tc IS DISTINCT FROM (public.my_membership()).transport_company_id THEN
        RAISE EXCEPTION 'ASSIGN_VEHICLE_NOT_OWN_FLEET: vehicle % does not belong to the caller''s own transport company', NEW.vehicle_id
          USING ERRCODE = 'P0031';
      END IF;
    ELSE
      -- Existing trip-link-only path, unchanged: a transport-side caller NOT
      -- performing the assign transition above may only ever change trip_id.
      IF NEW.company_id       IS DISTINCT FROM OLD.company_id
         OR NEW.branch_id     IS DISTINCT FROM OLD.branch_id
         OR NEW.driver_id     IS DISTINCT FROM OLD.driver_id
         OR NEW.vehicle_id    IS DISTINCT FROM OLD.vehicle_id
         OR NEW.scheduled_at  IS DISTINCT FROM OLD.scheduled_at
         OR NEW.status        IS DISTINCT FROM OLD.status
         OR NEW.recurrence    IS DISTINCT FROM OLD.recurrence
         OR NEW.recurrence_until IS DISTINCT FROM OLD.recurrence_until
         OR NEW.pickup_event_id IS DISTINCT FROM OLD.pickup_event_id
         OR NEW.notes         IS DISTINCT FROM OLD.notes
         OR NEW.created_by    IS DISTINCT FROM OLD.created_by
      THEN
        RAISE EXCEPTION 'TRANSPORT_MAY_ONLY_LINK_TRIP: a transport-side caller may only change trip_id on a pickup_assignments row'
          USING ERRCODE = 'P0016';
      END IF;
    END IF;
  END IF;

  -- (044) Company-staff path: the company that owns this request may never
  -- set driver_id/vehicle_id themselves, at any status — that decision
  -- belongs to the transport side alone. INSERT is separately locked down
  -- by Part B's WITH CHECK; this covers UPDATE, where RLS cannot diff
  -- OLD vs NEW columns.
  IF TG_OP = 'UPDATE' AND v_is_company_staff_path THEN
    IF NEW.driver_id IS DISTINCT FROM OLD.driver_id
       OR NEW.vehicle_id IS DISTINCT FROM OLD.vehicle_id
    THEN
      RAISE EXCEPTION 'COMPANY_MAY_NOT_ASSIGN: the requesting company may not set driver_id/vehicle_id — only the transport dispatcher may'
        USING ERRCODE = 'P0032';
    END IF;
  END IF;

  -- Nothing to validate if trip_id is absent, or unchanged on UPDATE
  -- (covers company-side / driver updates to unrelated columns).
  IF NEW.trip_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.trip_id IS NOT DISTINCT FROM OLD.trip_id THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_trip FROM public.trips WHERE id = NEW.trip_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'TRIP_NOT_FOUND: trip_id % does not exist', NEW.trip_id
      USING ERRCODE = 'P0002';
  END IF;

  -- Only the trip's OWN transport company (or admin) may link/unlink an
  -- assignment to it — the generator/company side requests pickups, it does
  -- not decide which transport haul they get grouped into.
  IF (public.my_membership()).role IS NOT NULL
     AND (public.my_membership()).role <> 'admin'
     AND (public.my_membership()).transport_company_id IS DISTINCT FROM v_trip.transport_company_id
  THEN
    RAISE EXCEPTION 'TRIP_LINK_TRANSPORT_ONLY: only the trip''s own transport company may link an assignment to it'
      USING ERRCODE = 'P0014';
  END IF;

  SELECT transport_company_id INTO v_driver_tc FROM public.drivers WHERE id = NEW.driver_id;
  IF v_driver_tc IS DISTINCT FROM v_trip.transport_company_id THEN
    RAISE EXCEPTION 'TRIP_DRIVER_MISMATCH: assignment driver does not belong to trip %''s transport company', NEW.trip_id
      USING ERRCODE = 'P0015';
  END IF;

  RETURN NEW;
END;
$$;

-- pickup_assignments_trip_link_guard_trigger (019) already fires BEFORE
-- INSERT OR UPDATE — CREATE OR REPLACE of the function body is sufficient,
-- no DROP/CREATE TRIGGER needed (the trigger's own event spec is unchanged).

-- ─────────────────────────────────────────────────────────────
-- E. pickup_assignments_document_gate — DIFF vs live: the trigger's event
--    spec changes from INSERT-only to INSERT OR UPDATE OF driver_id,
--    vehicle_id (required — item 8 — otherwise the assign-UPDATE would never
--    re-run these checks at all). The function gains an INSERT-time branch
--    that applies the company check alone and returns early when driver_id/
--    vehicle_id are both NULL (the company-request shape); every other path
--    (011's from-scratch INSERT with driver/vehicle already set, and the new
--    assign-UPDATE) falls through to the SAME transport_company/driver/
--    vehicle checks that already existed, byte-for-byte unchanged.
--
--    pickup_events_before_insert()'s own steps 4c/4d (042) are NOT touched by
--    this migration — they remain the execution-time backstop regardless of
--    what pickup_assignments ever validated, exactly as designed in 042.
-- --- diff ---
--    CREATE OR REPLACE FUNCTION public.pickup_assignments_document_gate()
--    ...
--    BEGIN
-- +    IF TG_OP = 'INSERT' THEN
--        IF public.is_owner_operationally_blocked('company', NEW.company_id) THEN
--          RAISE EXCEPTION 'COMPANY_NOT_ACTIVE: ...' USING ERRCODE = 'P0026';
--        END IF;
-- +
-- +      IF NEW.driver_id IS NULL AND NEW.vehicle_id IS NULL THEN
-- +        RETURN NEW;
-- +      END IF;
-- +    END IF;
--
--      SELECT transport_company_id INTO v_driver_tc FROM public.drivers WHERE id = NEW.driver_id;
--      IF public.is_owner_operationally_blocked('transport_company', v_driver_tc) THEN ... END IF;
--      IF public.is_owner_operationally_blocked('driver', NEW.driver_id) THEN ... END IF;
--      IF public.is_owner_operationally_blocked('vehicle', NEW.vehicle_id) THEN ... END IF;
--      RETURN NEW;
--    END;
-- --- end diff ---
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.pickup_assignments_document_gate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_driver_tc uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- The company's own document status always applies at request time,
    -- whether or not a driver/vehicle is attached yet.
    IF public.is_owner_operationally_blocked('company', NEW.company_id) THEN
      RAISE EXCEPTION 'COMPANY_NOT_ACTIVE: company % does not have complete, current, verified required documents and cannot schedule pickups', NEW.company_id
        USING ERRCODE = 'P0026';
    END IF;

    -- Company-request shape (044): no driver/vehicle yet — nothing further
    -- to check until assignment.
    IF NEW.driver_id IS NULL AND NEW.vehicle_id IS NULL THEN
      RETURN NEW;
    END IF;
  END IF;

  -- Reached for: (a) an INSERT that already supplies driver_id/vehicle_id
  -- (011's transport-side from-scratch path, unchanged shape), or (b) an
  -- UPDATE of driver_id/vehicle_id (044's new dispatcher-assign transition,
  -- where the company block was already applied at the original request
  -- INSERT and is not re-checked here — see the migration header's scope
  -- note on this).
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

DROP TRIGGER IF EXISTS pickup_assignments_document_gate_trigger ON public.pickup_assignments;
CREATE TRIGGER pickup_assignments_document_gate_trigger
  BEFORE INSERT OR UPDATE OF driver_id, vehicle_id ON public.pickup_assignments
  FOR EACH ROW EXECUTE FUNCTION public.pickup_assignments_document_gate();

-- ─────────────────────────────────────────────────────────────
-- F. FLAGGED, NOT ONE OF THE 8 NUMBERED ITEMS — pickup_assignments_select:
--    without this, a linked transporter's staff has no way to ever SEE a
--    company's unassigned 'requested' rows (the pre-existing driver-fleet
--    arm can never match a NULL driver_id), so there is nothing to discover
--    and assign. New 5th OR-arm mirrors Part C's own link condition. Every
--    other arm is byte-for-byte unchanged from the live policy.
-- ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS pickup_assignments_select ON public.pickup_assignments;
CREATE POLICY pickup_assignments_select ON public.pickup_assignments FOR SELECT
  TO authenticated
  USING (
    company_id = (public.my_membership()).company_id
    OR (public.my_membership()).role = 'admin'
    OR EXISTS (
         SELECT 1 FROM public.drivers d
         WHERE d.id = pickup_assignments.driver_id AND d.profile_id = auth.uid()
       )
    OR (
         (public.my_membership()).role IN ('owner','manager','dispatcher')
         AND (public.my_membership()).transport_company_id IS NOT NULL
         AND EXISTS (
              SELECT 1 FROM public.drivers d
              WHERE d.id = pickup_assignments.driver_id
                AND d.transport_company_id = (public.my_membership()).transport_company_id
            )
       )
    -- (044) NEW: a linked transporter's staff can see a still-unassigned
    -- 'requested' row for a company it's actively linked to.
    OR (
         status = 'requested'
         AND (public.my_membership()).role IN ('owner','manager','dispatcher')
         AND (public.my_membership()).transport_company_id IS NOT NULL
         AND EXISTS (
              SELECT 1 FROM public.company_transporters ct
              WHERE ct.status = 'active'
                AND ct.company_id = pickup_assignments.company_id
                AND ct.transport_company_id = (public.my_membership()).transport_company_id
            )
       )
  );

-- ─────────────────────────────────────────────────────────────
-- G. FLAGGED, NOT ONE OF THE 8 NUMBERED ITEMS — notify_assignment_created():
--    fires AFTER INSERT only today. In the new flow the driver isn't known
--    until the later assign-UPDATE, so a driver would never be notified in
--    practice (the trigger already silently no-ops when driver_id is NULL —
--    that guard was written for "not yet invited", not "not yet assigned",
--    but has the same effect here). Extended to also fire when driver_id is
--    set via UPDATE; guarded so it never double-fires or fires on an
--    unrelated column touch. 011's from-scratch INSERT path (driver_id
--    already set at INSERT) is unaffected — same notification, same timing
--    as today.
-- --- diff ---
--    CREATE OR REPLACE FUNCTION public.notify_assignment_created()
--    ...
--    BEGIN
-- +    IF TG_OP = 'UPDATE' AND NEW.driver_id IS NOT DISTINCT FROM OLD.driver_id THEN
-- +      RETURN NEW;
-- +    END IF;
-- +    IF NEW.driver_id IS NULL THEN
-- +      RETURN NEW;
-- +    END IF;
--
--      SELECT profile_id INTO v_profile_id FROM public.drivers WHERE id = NEW.driver_id;
--      -- (unchanged) Driver has no linked account yet — nothing to notify.
--      IF v_profile_id IS NULL THEN RETURN NEW; END IF;
--      INSERT INTO public.notifications (...) VALUES (...);  -- unchanged
--      RETURN NEW;
--    END;
-- --- end diff ---
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.notify_assignment_created()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_profile_id uuid;
BEGIN
  -- (044) On UPDATE, only proceed if driver_id actually changed (the column-
  -- list trigger fires whenever driver_id is in the SET list, even as a
  -- no-op re-set) and is now non-null.
  IF TG_OP = 'UPDATE' AND NEW.driver_id IS NOT DISTINCT FROM OLD.driver_id THEN
    RETURN NEW;
  END IF;
  IF NEW.driver_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT profile_id INTO v_profile_id
  FROM public.drivers
  WHERE id = NEW.driver_id;

  -- Driver has no linked account yet (not invited) — nothing to notify.
  IF v_profile_id IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.notifications
    (profile_id, company_id, title_ar, title_en, body_ar, body_en, link)
  VALUES (
    v_profile_id,
    NEW.company_id,
    'مهمة التقاط جديدة',
    'New Pickup Assignment',
    'تم إسناد مهمة التقاط جديدة إليك، موعدها ' || to_char(NEW.scheduled_at AT TIME ZONE 'Asia/Riyadh', 'YYYY-MM-DD HH24:MI'),
    'A new pickup has been assigned to you, scheduled ' || to_char(NEW.scheduled_at AT TIME ZONE 'Asia/Riyadh', 'YYYY-MM-DD HH24:MI'),
    '/driver/schedule'
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS pickup_assignments_notify_created ON public.pickup_assignments;
CREATE TRIGGER pickup_assignments_notify_created
  AFTER INSERT OR UPDATE OF driver_id ON public.pickup_assignments
  FOR EACH ROW EXECUTE FUNCTION public.notify_assignment_created();

-- ═══════════════════════════════════════════════════════════════════════════
-- END OF MIGRATION 044
-- ═══════════════════════════════════════════════════════════════════════════
