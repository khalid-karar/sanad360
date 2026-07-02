-- ═══════════════════════════════════════════════════════════════════════════
-- Sanad 360 – Migration 015: PDPL erasure (crypto-shred / PII partition)
-- ═══════════════════════════════════════════════════════════════════════════
-- Design (full rationale in PDPL_ERASURE.md):
--
--   The ledger is append-only BY DESIGN and retained under the
--   legal-obligation basis (waste-transfer compliance records). Personal
--   identity, however, lives ONLY in MUTABLE tables — drivers, profiles —
--   which the immutable tables reference by opaque UUID. Erasure therefore
--   = anonymize the identity rows in place ("tombstone"), delete the
--   person's memberships, and disable their auth account (done by the
--   operator script — auth.users is GoTrue's domain).
--
--   The profile row is NOT deleted: pickup_events.created_by references it,
--   and deleting it would either break the ledger's referential integrity or
--   require touching immutable rows. An anonymized tombstone satisfies both
--   PDPL (no personal data remains) and the ledger (FKs intact).
--
--   Every erasure is itself recorded in an append-only erasure_log —
--   PDPL Art. 18-style accountability.
--
--   Callable by service_role ONLY (operator script scripts/pdpl-erase.mjs);
--   EXECUTE is revoked from authenticated/anon.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────
-- 1. Erasure accountability log (append-only, service-role only)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE public.erasure_log (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_type  text        NOT NULL CHECK (subject_type IN ('driver')),
  subject_id    uuid        NOT NULL,   -- the drivers.id (opaque, non-personal)
  profile_id    uuid,                   -- tombstoned profile, if one was linked
  reason        text,
  performed_at  timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.erasure_log TO service_role;
-- authenticated/anon: no grants at all — not even SELECT.
ALTER TABLE public.erasure_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.erasure_log FROM authenticated, anon;

-- ─────────────────────────────────────────────────────────────
-- 2. erase_driver_pii(driver_id, reason)
--    Anonymizes every mutable row holding the driver's identity.
--    Immutable tables (pickup_events, disposal_confirmations, audit_log)
--    are NOT touched — they reference only opaque UUIDs after this runs.
-- ─────────────────────────────────────────────────────────────
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

  -- 2a. Driver record → anonymous tombstone (license_number is NOT NULL,
  --     so it becomes an opaque stub, unique per driver).
  UPDATE public.drivers
  SET name_ar         = 'محذوف بموجب نظام حماية البيانات الشخصية',
      license_number  = v_stub,
      absher_verified = false,
      status          = 'inactive',
      profile_id      = NULL
  WHERE id = p_driver_id;

  IF v_profile_id IS NOT NULL THEN
    -- 2b. Profile → anonymous tombstone. The row must SURVIVE (ledger FKs).
    UPDATE public.profiles
    SET name_ar = 'محذوف', name_en = NULL, phone = NULL
    WHERE id = v_profile_id;

    -- 2c. Memberships and tenant selection: pure linkage, safe to delete.
    DELETE FROM public.user_active_tenant WHERE user_id = v_profile_id;
    DELETE FROM public.memberships        WHERE user_id = v_profile_id;

    -- 2d. Their notification feed may quote schedule details — delete it.
    DELETE FROM public.notifications WHERE profile_id = v_profile_id;
  END IF;

  -- 2e. Accountability record.
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

-- Service-role only. Belt-and-suspenders: revoke from everyone else,
-- including PUBLIC (functions are executable by PUBLIC by default).
REVOKE EXECUTE ON FUNCTION public.erase_driver_pii(uuid, text) FROM PUBLIC, authenticated, anon;
GRANT  EXECUTE ON FUNCTION public.erase_driver_pii(uuid, text) TO service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- END OF MIGRATION 015
-- ═══════════════════════════════════════════════════════════════════════════
