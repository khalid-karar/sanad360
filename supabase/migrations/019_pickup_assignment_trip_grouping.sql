-- ═══════════════════════════════════════════════════════════════════════════
-- Sanad 360 – Migration 019: Dispatcher groups pickup requests into a trip
-- ═══════════════════════════════════════════════════════════════════════════
-- CP1 (018) made trips transport-company-owned (trips_insert is owner/
-- manager/dispatcher of the TRANSPORT side only — a generator/company user
-- has no path to create one). What was still missing: a way for the
-- dispatcher to say "these pending pickup requests will travel together as
-- this trip."
--
-- pickup_events (the append-only ledger) is the wrong place to retroact this
-- from — UPDATE is revoked there by design, so trip_id can only ever be set
-- AT INSERT time by the driver's device (already supported since 018). The
-- correct, MUTABLE place to group is pickup_assignments (the company's
-- pickup REQUEST/schedule, not the immutable proof-of-pickup): the
-- dispatcher links a pending assignment to a trip here; when the driver
-- later completes that assignment, the app carries trip_id through onto the
-- pickup_event it creates (src/stores/driverStore.ts) — so by the time the
-- ledger row exists, trip_id is already correct and never needs an UPDATE.
--
-- Ownership stays exactly where 018 put it: only the TRIP'S OWN transport
-- company (or admin) may link/unlink an assignment to it — enforced by a
-- trigger, not just hidden in the UI. The existing company-side UPDATE
-- policy (013) is untouched; a new, narrowly-scoped transport-side UPDATE
-- policy is added, and a trigger clamps it to touching ONLY trip_id (a
-- transport dispatcher must not be able to rewrite a company's schedule,
-- branch, or timing through this new path).
-- ═══════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────
-- Schema
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.pickup_assignments
  ADD COLUMN trip_id uuid REFERENCES public.trips(id);

CREATE INDEX pickup_assignments_trip_id_idx ON public.pickup_assignments(trip_id);

-- ─────────────────────────────────────────────────────────────
-- BEFORE INSERT OR UPDATE: validate + restrict trip linkage
--   1. If trip_id is being set (INSERT or changed on UPDATE): the trip must
--      exist, must belong to the CALLER's own transport company (or admin),
--      and the assignment's driver must belong to that same transport
--      company — mirrors trips_before_insert / pickup_events_before_insert's
--      FK-consistency pattern (018).
--   2. If the caller is transport-side staff (not company staff, not the
--      assigned driver) — i.e. reaching this row only through the new
--      pickup_assignments_update_transport_trip_link policy below — they may
--      change trip_id and nothing else. Company-side callers and the
--      assigned driver are unaffected (their existing UPDATE paths already
--      manage status/notes/etc. and are not restricted here).
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.pickup_assignments_trip_link_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_trip       public.trips%ROWTYPE;
  v_driver_tc  uuid;
  v_is_transport_staff_path boolean;
BEGIN
  v_is_transport_staff_path :=
    (public.my_membership()).role IN ('owner','manager','dispatcher')
    AND (public.my_membership()).transport_company_id IS NOT NULL;

  -- Field-restriction: a transport-staff caller acting through this new path
  -- may touch trip_id ONLY. (Company staff / the assigned driver reach this
  -- row via the pre-existing 013 policy instead and are not restricted here.)
  IF TG_OP = 'UPDATE' AND v_is_transport_staff_path THEN
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

CREATE TRIGGER pickup_assignments_trip_link_guard_trigger
  BEFORE INSERT OR UPDATE ON public.pickup_assignments
  FOR EACH ROW EXECUTE FUNCTION public.pickup_assignments_trip_link_guard();

-- ─────────────────────────────────────────────────────────────
-- RLS: additive UPDATE policy for transport staff, scoped to their own
-- fleet's assignments — mirrors the transport-staff arm of the 013 SELECT
-- policy exactly. Combined with the trigger above, this can only ever
-- result in a trip_id change; every other column stays under the existing
-- company-side / driver-side policies.
-- ─────────────────────────────────────────────────────────────
CREATE POLICY pickup_assignments_update_transport_trip_link ON public.pickup_assignments
  FOR UPDATE TO authenticated
  USING (
    (public.my_membership()).role IN ('owner','manager','dispatcher')
    AND (public.my_membership()).transport_company_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.drivers d
      WHERE d.id = pickup_assignments.driver_id
        AND d.transport_company_id = (public.my_membership()).transport_company_id
    )
  );

-- ═══════════════════════════════════════════════════════════════════════════
-- END OF MIGRATION 019
-- ═══════════════════════════════════════════════════════════════════════════
