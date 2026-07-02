-- ═══════════════════════════════════════════════════════════════════════════
-- Sanad 360 – Migration 011: Server-generated notifications + transport dispatch
-- ═══════════════════════════════════════════════════════════════════════════
-- 1) NOTIFICATIONS WERE CLIENT-LOCAL ONLY. The notifications table existed
--    (003) but nothing server-side ever wrote to it — the RLS INSERT policy is
--    self-only, so a dispatcher could not notify a driver, and the in-app
--    stores were session-local mocks. A driver never learned about a new
--    assignment without opening the schedule page.
--    Fix: SECURITY DEFINER triggers on pickup_assignments write the rows the
--    client cannot: assignment created → notify the assigned driver;
--    assignment completed/cancelled → notify whoever scheduled it.
--
-- 2) DISPATCHER ROLE CLEANUP. The seed and role routing treat `dispatcher` as
--    a TRANSPORT-side role (the transporter dispatches its own fleet), but the
--    003 assignment policies only granted company-scoped inserts/updates —
--    a transport dispatcher could not schedule anything. Additive policies
--    below let transport owner/manager/dispatcher manage assignments for
--    their OWN drivers at companies they are ACTIVELY linked to. The
--    company-side policies (generator requesting a pickup) remain unchanged.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────
-- 1a. Assignment created → notify the assigned driver
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

CREATE TRIGGER pickup_assignments_notify_created
  AFTER INSERT ON public.pickup_assignments
  FOR EACH ROW EXECUTE FUNCTION public.notify_assignment_created();

-- ─────────────────────────────────────────────────────────────
-- 1b. Assignment completed / cancelled → notify the scheduler
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.notify_assignment_closed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.status = OLD.status OR NEW.status NOT IN ('completed','cancelled') THEN
    RETURN NEW;
  END IF;

  -- No scheduler recorded (e.g. seed/backfill rows) — nothing to notify.
  IF NEW.created_by IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.notifications
    (profile_id, company_id, title_ar, title_en, body_ar, body_en, link)
  VALUES (
    NEW.created_by,
    NEW.company_id,
    CASE WHEN NEW.status = 'completed' THEN 'اكتملت مهمة الالتقاط' ELSE 'أُلغيت مهمة الالتقاط' END,
    CASE WHEN NEW.status = 'completed' THEN 'Pickup Completed' ELSE 'Pickup Cancelled' END,
    CASE WHEN NEW.status = 'completed'
      THEN 'اكتملت مهمة الالتقاط المجدولة وتم تسجيلها في السجل'
      ELSE 'قام السائق بإلغاء مهمة الالتقاط المجدولة' END,
    CASE WHEN NEW.status = 'completed'
      THEN 'The scheduled pickup was completed and recorded in the ledger'
      ELSE 'The scheduled pickup was cancelled by the driver' END,
    '/company/schedule'
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER pickup_assignments_notify_closed
  AFTER UPDATE OF status ON public.pickup_assignments
  FOR EACH ROW EXECUTE FUNCTION public.notify_assignment_closed();

-- ─────────────────────────────────────────────────────────────
-- 2. Transport-side dispatch: additive assignment policies
--    (own drivers only, actively linked companies only)
-- ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS pickup_assignments_insert_transport ON public.pickup_assignments;
CREATE POLICY pickup_assignments_insert_transport
  ON public.pickup_assignments
  FOR INSERT TO authenticated
  WITH CHECK (
    (public.my_membership()).role IN ('owner','manager','dispatcher')
    AND (public.my_membership()).transport_company_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.drivers d
      WHERE d.id = pickup_assignments.driver_id
        AND d.transport_company_id = (public.my_membership()).transport_company_id
    )
    AND EXISTS (
      SELECT 1 FROM public.company_transporters ct
      WHERE ct.status = 'active'
        AND ct.company_id = pickup_assignments.company_id
        AND ct.transport_company_id = (public.my_membership()).transport_company_id
    )
  );

DROP POLICY IF EXISTS pickup_assignments_update_transport ON public.pickup_assignments;
CREATE POLICY pickup_assignments_update_transport
  ON public.pickup_assignments
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
-- END OF MIGRATION 011
-- ═══════════════════════════════════════════════════════════════════════════
