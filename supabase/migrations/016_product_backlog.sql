-- ═══════════════════════════════════════════════════════════════════════════
-- Sanad 360 – Migration 016: product backlog (scale photo, recurrence,
--                            driver phone, company monthly report)
-- ═══════════════════════════════════════════════════════════════════════════
-- 1) WEIGHT-CAPTURE PHOTO ASSIST: the typed weight was the least-evidenced
--    datum in the record. New optional evidence: a photo of the scale /
--    weighbridge display, stored + hashed like all other evidence.
-- 2) RECURRING ASSIGNMENTS: weekly/daily pickups without re-entry. When a
--    recurring assignment completes, a trigger inserts the next occurrence.
-- 3) DRIVER PHONE (for WhatsApp deep-links): dispatch already collects the
--    phone at invite time; persist it on the fleet record so schedulers can
--    open a WhatsApp thread. PII — added to the PDPL erasure function below.
-- 4) COMPANY-WIDE MONTHLY PDF: new report_type for inspection_pdfs.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────
-- 1. Scale-display photo on the ledger (same pattern as 005 evidence)
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.pickup_events
  ADD COLUMN IF NOT EXISTS scale_photo_path   text,
  ADD COLUMN IF NOT EXISTS scale_photo_sha256 text;

-- SELECT * views freeze columns — recreate (grants survive OR REPLACE).
CREATE OR REPLACE VIEW public.pickup_events_latest
  WITH (security_invoker = true) AS
SELECT DISTINCT ON (logical_id) *
FROM public.pickup_events
ORDER BY logical_id, revision DESC;

-- ─────────────────────────────────────────────────────────────
-- 2. Assignment recurrence
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.pickup_assignments
  ADD COLUMN IF NOT EXISTS recurrence text NOT NULL DEFAULT 'none'
    CHECK (recurrence IN ('none','daily','weekly')),
  ADD COLUMN IF NOT EXISTS recurrence_until date;

-- When a recurring assignment is COMPLETED, materialize the next occurrence
-- (same company/branch/driver/vehicle/creator), stopping past recurrence_until.
-- SECURITY DEFINER so the driver completing the job doesn't need INSERT
-- rights on assignments; search_path locked as everywhere else.
CREATE OR REPLACE FUNCTION public.spawn_recurring_assignment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_next timestamptz;
BEGIN
  IF NEW.status <> 'completed' OR OLD.status = 'completed' THEN
    RETURN NEW;
  END IF;
  IF NEW.recurrence NOT IN ('daily','weekly') THEN
    RETURN NEW;
  END IF;

  v_next := NEW.scheduled_at + CASE NEW.recurrence
              WHEN 'daily' THEN interval '1 day'
              ELSE interval '7 days' END;

  IF NEW.recurrence_until IS NOT NULL AND v_next::date > NEW.recurrence_until THEN
    RETURN NEW;  -- series finished
  END IF;

  INSERT INTO public.pickup_assignments
    (company_id, branch_id, driver_id, vehicle_id, scheduled_at,
     status, notes, created_by, recurrence, recurrence_until)
  VALUES
    (NEW.company_id, NEW.branch_id, NEW.driver_id, NEW.vehicle_id, v_next,
     'pending', NEW.notes, NEW.created_by, NEW.recurrence, NEW.recurrence_until);

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS pickup_assignments_spawn_recurring ON public.pickup_assignments;
CREATE TRIGGER pickup_assignments_spawn_recurring
  AFTER UPDATE OF status ON public.pickup_assignments
  FOR EACH ROW EXECUTE FUNCTION public.spawn_recurring_assignment();

-- ─────────────────────────────────────────────────────────────
-- 3. Driver phone (WhatsApp deep-links). PII → erasure updated below.
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.drivers
  ADD COLUMN IF NOT EXISTS phone text;

CREATE OR REPLACE FUNCTION public.erase_driver_pii(p_driver_id uuid, p_reason text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_driver     public.drivers%ROWTYPE;
  v_profile_id uuid;
  v_stub       text;
BEGIN
  SELECT * INTO v_driver FROM public.drivers WHERE id = p_driver_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'DRIVER_NOT_FOUND: %', p_driver_id USING ERRCODE = 'P0002';
  END IF;

  v_profile_id := v_driver.profile_id;
  v_stub := 'REDACTED-' || left(p_driver_id::text, 8);

  UPDATE public.drivers
  SET name_ar         = 'محذوف بموجب نظام حماية البيانات الشخصية',
      license_number  = v_stub,
      phone           = NULL,          -- 016: WhatsApp phone is PII too
      absher_verified = false,
      status          = 'inactive',
      profile_id      = NULL
  WHERE id = p_driver_id;

  IF v_profile_id IS NOT NULL THEN
    UPDATE public.profiles
    SET name_ar = 'محذوف', name_en = NULL, phone = NULL
    WHERE id = v_profile_id;

    DELETE FROM public.user_active_tenant WHERE user_id = v_profile_id;
    DELETE FROM public.memberships        WHERE user_id = v_profile_id;
    DELETE FROM public.notifications      WHERE profile_id = v_profile_id;
  END IF;

  INSERT INTO public.erasure_log (subject_type, subject_id, profile_id, reason)
  VALUES ('driver', p_driver_id, v_profile_id, p_reason);

  RETURN jsonb_build_object(
    'driver_id',    p_driver_id,
    'profile_id',   v_profile_id,
    'license_stub', v_stub,
    'note',         'auth account must be disabled by the operator script (GoTrue admin API)'
  );
END;
$$;

-- ─────────────────────────────────────────────────────────────
-- 4. Company-wide monthly report type
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.inspection_pdfs
  DROP CONSTRAINT IF EXISTS inspection_pdfs_report_type_check;
ALTER TABLE public.inspection_pdfs
  ADD CONSTRAINT inspection_pdfs_report_type_check
  CHECK (report_type IN ('single_pickup','monthly_summary','monthly_company'));

-- ═══════════════════════════════════════════════════════════════════════════
-- END OF MIGRATION 016
-- ═══════════════════════════════════════════════════════════════════════════
