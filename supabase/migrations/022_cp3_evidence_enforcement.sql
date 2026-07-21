-- ═══════════════════════════════════════════════════════════════════════════
-- CP3 — Make "compliant" mean something: server-enforced required evidence,
-- and the last piece of CP4: dynamic, server-signed, short-TTL branch QR.
--
-- WHAT THIS MIGRATION DOES
--   Part A: a per-tenant/per-waste_stream `evidence_requirements` config
--   table, a resolver function, and a rewrite of pickup_events_before_insert
--   so that a record can never be `compliant` while a REQUIRED evidence item
--   is missing — regardless of risk_score. Insert is never hard-blocked
--   (guardrail: a driver in the field must still be able to record what
--   happened); the gap is made visible via compliance_status + explicit
--   `missing_required:<item>` flags instead.
--
--   Part B: branches.qr_token stops being a value ever displayed to anyone —
--   it becomes a per-branch HMAC secret, held server-side only. The branch
--   operator's device requests a signed, 90-second token from the PDF
--   service (services/pdf, app code — not in this migration); the driver
--   scans it into qr_code_value exactly as before. This migration replaces
--   the old direct-equality QR check with HMAC verification via pgcrypto,
--   plus replay rejection.
--
-- DESIGN DECISIONS RECORDED FOR REVIEW (per user sign-off on the CP3 plan)
--
--   1. THE NEW pickup_events_qr_or_reason_check CONSTRAINT IS ADDED NOT VALID.
--      Every pickup_event row that already exists (seeded locally on every
--      `db reset`, and any real row already on staging/production before
--      this migration runs via `db push`) has qr_code_value possibly NULL
--      with no qr_skip_reason — that's exactly the silent-skip shape CP3 is
--      closing off going forward, but it already happened. Two ways to land
--      the constraint: validate it against history (requires either the old
--      rows already satisfy it, which they don't, or backfilling them with
--      a synthetic reason), or add it NOT VALID so Postgres skips the
--      initial table scan and enforces it only from here forward. Chose
--      NOT VALID, not backfill:
--        - pickup_events is an append-only evidence ledger (guardrail:
--          "append-only ledger/audit untouched"). Backfilling would mean
--          writing a synthetic `qr_skip_reason = 'legacy_pre_cp3'` into
--          historical field-evidence rows that never actually recorded a
--          reason — manufacturing a fact after the record was made, which
--          is a worse violation of the ledger's integrity than just leaving
--          old rows alone.
--        - pickup_events has no UPDATE path for authenticated (revoked at
--          the privilege level since migration 001; ledger-immutability
--          tests assert this), so the one real caveat of NOT VALID — that
--          Postgres re-checks a NOT VALID constraint on any UPDATE of a
--          pre-existing row — can never actually trigger here. NOT VALID is
--          therefore just as strong as a validated constraint for every row
--          that matters (every future INSERT), with none of the "we wrote
--          fake data into history" cost.
--      (Same problem class as CP2's compliance_exempt backfill, different
--      answer, because CP2 had a real, deliberate value to write —
--      "this row existed before the gate" — while here there is no true
--      value to backfill, only a placeholder.)
--
--   2. branch_qr_used_tokens GROWS UNBOUNDED — one row per validated pickup,
--      forever, with no cleanup in this migration. Fine at pilot scale (a
--      handful of pickups/day per branch); it becomes a real operational
--      concern once volume grows, because every future INSERT still has to
--      probe this table via its PK. Tracked as a concrete follow-up in
--      PRODUCTION_HARDENING.md under CP10 ("scheduled DELETE FROM
--      branch_qr_used_tokens WHERE expires_at < now()") — not a vague
--      comment, an actual task with an owner-visible checklist entry.
--
--   3. evidence_requirements RLS: global rows (transport_company_id IS
--      NULL) are readable by every authenticated user (they're the airtight
--      default, not a secret); tenant-specific override rows are readable
--      ONLY by members of that transport_company (or admin) — a transporter
--      must never be able to read another transporter's custom evidence
--      policy. See Part B.
--
--   4. compliance_status is forced straight to 'non_compliant' (not capped
--      at 'warning') whenever any required item is missing — the literal
--      reading of "can never be compliant". risk_score's existing weights
--      are UNCHANGED (every current risk-engine test's exact score math
--      stays valid); the override is a separate, additional rule layered on
--      top, not a reweighting. This means a record CAN show risk_score = 0
--      (or otherwise low) and still be non_compliant, purely because a
--      policy-required item (e.g. a tenant-mandated receipt) is absent —
--      that's intentional and is the entire point of Part A. App-code
--      consequence (review queue / inspection PDF, next phase): surface
--      `missing_required:<item>` flags prominently, not just risk_score —
--      a manager must not read "low score" as "fine" when it's actually
--      "policy violation, zero measured risk".
--
--   5. Part A #4 (driver skips an optional item) and Part B #7 (branch
--      device down / scan failed, even for a REQUIRED qr) are the same
--      shape — "no QR value, but a stated reason" — unified into one
--      mechanism: qr_skip_reason + qr_skip_reason_notes, enforced by #1's
--      NOT VALID check. Flags: qr_skipped_with_reason always when a reason
--      is given; reduced_verification additionally when qr was actually
--      required for this event's waste_types.
--
--   6. Branch QR verification happens IN POSTGRES (pgcrypto hmac()), not in
--      the Node PDF service, even though issuance does happen there. Drivers
--      insert pickup_events directly via PostgREST — never proxied through
--      the Node service — so the trigger cannot trust an upstream "Node
--      already checked this" claim; it must independently verify the
--      signature itself. That forces the token encoding to plain base64
--      (not tripQr.ts's base64url) so Postgres's built-in encode()/decode()
--      produce byte-identical output to Node's Buffer.toString('base64').
--
--   7a. QR signature comparison (`v_sig_b64 = v_expected_sig` in B4) is a
--      plain text equality, not constant-time. Accepted minor: the timing
--      side-channel would let an attacker who can already reach PostgREST
--      with unlimited attempts recover a per-branch HMAC signature byte-by-
--      byte — a real theoretical weakness, but one that requires an
--      already-authenticated, high-volume attacker probing a single
--      branch's 90-second-TTL tokens, which the TTL itself already limits
--      the value of. Not fixed in this migration; flagged for a future pass
--      using pgcrypto's constant-time compare if/when warranted.
--
--   7. Relay-attack signal: a token can be cryptographically valid (right
--      branch, right secret, not expired, not replayed) while gps_lat/lng
--      says the phone is nowhere near that branch — that's more suspicious
--      than a bare geofence miss (it suggests the QR was captured remotely,
--      e.g. a photo of the operator's screen relayed to a driver elsewhere).
--      possible_relay_attack adds +30 ON TOP of the existing geofence_failed
--      (+20), landing solidly in non_compliant. A valid QR is corroborating
--      evidence of presence, never proof on its own.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────
-- PART A — SCHEMA ONLY
-- ─────────────────────────────────────────────────────────────

-- hmac() lives in pgcrypto; already relied on indirectly via crypt()/
-- gen_salt() elsewhere, but make the dependency explicit and idempotent.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ─────────────────────────────────────────────────────────────
-- A1. EVIDENCE_REQUIREMENTS  (which evidence items are mandatory, per
--     waste_stream and optionally per tenant)
--
-- Four-tier resolution, most specific wins (see resolve_required_evidence()
-- in Part B): (tenant, stream) > (tenant, '*') > (NULL, stream) > (NULL, '*').
-- waste_stream = '*' is the wildcard sentinel ("applies to any stream not
-- more specifically configured"); real stream values match the app's
-- WasteType domain (src/lib/database.types.ts): plastic, organic,
-- industrial, electronic, chemical, medical.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE public.evidence_requirements (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  waste_stream          text        NOT NULL,
  transport_company_id  uuid        REFERENCES public.transport_companies(id),
  required_items        text[]      NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT evidence_requirements_items_check CHECK (
    array_length(required_items, 1) > 0
    AND required_items <@ ARRAY['qr','geofenced_gps','photo','receipt','signature','scale_photo']::text[]
  )
);

-- Two partial unique indexes (not one plain UNIQUE) because a plain
-- UNIQUE(waste_stream, transport_company_id) would let multiple global rows
-- (transport_company_id NULL) coexist for the same waste_stream — Postgres
-- treats NULL <> NULL, so a naive UNIQUE constraint doesn't actually dedupe
-- the "global default" tier. These two indexes each enforce "at most one
-- row" within their own tier.
CREATE UNIQUE INDEX evidence_requirements_tenant_uidx
  ON public.evidence_requirements(waste_stream, transport_company_id)
  WHERE transport_company_id IS NOT NULL;
CREATE UNIQUE INDEX evidence_requirements_global_uidx
  ON public.evidence_requirements(waste_stream)
  WHERE transport_company_id IS NULL;

-- The airtight default (brief's exact wording): qr + geofenced_gps + photo
-- + signature required; receipt + scale_photo optional-but-recommended
-- (simply absent from every seeded row — "not required" is the default for
-- anything not listed).
INSERT INTO public.evidence_requirements (waste_stream, transport_company_id, required_items)
VALUES ('*', NULL, ARRAY['qr','geofenced_gps','photo','signature']);

-- ─────────────────────────────────────────────────────────────
-- A2. PICKUP_EVENTS — new columns for the unified skip-with-reason path
--     (decision 5 above). NOT a hard block on missing evidence (decision 3
--     of the original CP3 brief) — this is a narrower, purely-procedural
--     rule: never let a record through with a silently-null QR and zero
--     explanation of why.
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.pickup_events
  ADD COLUMN qr_skip_reason text
    CHECK (qr_skip_reason IS NULL OR qr_skip_reason IN (
      'device_unavailable', 'scan_failed', 'not_applicable_for_stream', 'other'
    )),
  ADD COLUMN qr_skip_reason_notes text;

ALTER TABLE public.pickup_events
  ADD CONSTRAINT pickup_events_skip_reason_notes_check CHECK (
    qr_skip_reason <> 'other'
    OR (qr_skip_reason_notes IS NOT NULL AND length(trim(qr_skip_reason_notes)) > 0)
  );

-- Decision 1 above: NOT VALID — skips validating existing rows, enforced on
-- every INSERT from here forward. pickup_events has no UPDATE path for
-- authenticated (privilege-revoked since migration 001; see
-- ledger-immutability tests), so NOT VALID's "still re-checked on UPDATE"
-- caveat can never actually fire against a pre-existing row.
ALTER TABLE public.pickup_events
  ADD CONSTRAINT pickup_events_qr_or_reason_check CHECK (
    qr_code_value IS NOT NULL OR qr_skip_reason IS NOT NULL
  ) NOT VALID;

-- ─────────────────────────────────────────────────────────────
-- A3. BRANCH_QR_USED_TOKENS  (replay protection — decision 2 above: grows
--     unbounded, no cleanup in this migration, tracked in
--     PRODUCTION_HARDENING.md under CP10)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE public.branch_qr_used_tokens (
  signature   text        PRIMARY KEY,
  branch_id   uuid        NOT NULL REFERENCES public.branches(id),
  used_at     timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL
);
CREATE INDEX branch_qr_used_tokens_expires_at_idx ON public.branch_qr_used_tokens(expires_at);

-- ─────────────────────────────────────────────────────────────
-- PART B — RLS / FUNCTIONS / TRIGGERS / GRANTS
-- ─────────────────────────────────────────────────────────────

-- ─────────────────────────────────────────────────────────────
-- B1. evidence_requirements RLS (decision 3 above)
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.evidence_requirements ENABLE ROW LEVEL SECURITY;

CREATE POLICY evidence_requirements_select ON public.evidence_requirements
  FOR SELECT TO authenticated
  USING (
    transport_company_id IS NULL
    OR transport_company_id = (public.my_membership()).transport_company_id
    OR (public.my_membership()).role = 'admin'
  );

GRANT SELECT ON public.evidence_requirements TO authenticated;
GRANT ALL    ON public.evidence_requirements TO service_role;
-- INSERT/UPDATE: service_role / admin console only (global config + tenant
-- overrides), mirrors required_documents (migration 021).

-- ─────────────────────────────────────────────────────────────
-- B2. branch_qr_used_tokens: locked down entirely. Only the SECURITY
--     DEFINER pickup_events_before_insert trigger (which runs as its
--     defining role, bypassing RLS) and service_role can touch this table —
--     it's write-once internal state, never queried directly by any client.
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.branch_qr_used_tokens ENABLE ROW LEVEL SECURITY;
-- No policies: default-deny for authenticated/anon.
GRANT ALL ON public.branch_qr_used_tokens TO service_role;

-- ─────────────────────────────────────────────────────────────
-- B3. resolve_required_evidence — four-tier lookup, union across a mixed
--     pickup's waste_types (most conservative: a pickup carrying two waste
--     types must satisfy the union of both streams' requirements). Exposed
--     to authenticated so the driver UI can ask "what's required here?"
--     from the same source of truth the trigger enforces, instead of
--     duplicating the list client-side and risking drift.
--
--     SECURITY INVOKER (not DEFINER): this function reads
--     evidence_requirements, whose RLS (B1) restricts tenant-specific rows
--     to that tenant's own members. If this ran as DEFINER, any signed-in
--     user could pass an arbitrary transport_company_id and read another
--     transporter's custom policy, bypassing B1 entirely. As INVOKER, a
--     direct client call sees only global rows + rows for the caller's own
--     transport_company_id (RLS enforced normally). It still works
--     correctly inside pickup_events_before_insert (B4) because that
--     trigger itself is SECURITY DEFINER — Postgres runs the whole trigger,
--     including this call, as the trigger's definer role, which bypasses
--     RLS there as intended.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.resolve_required_evidence(
  p_transport_company_id uuid,
  p_waste_types text[]
)
RETURNS text[]
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_streams     text[];
  v_stream      text;
  v_row_items   text[];
  v_result      text[] := '{}';
BEGIN
  v_streams := p_waste_types;
  IF v_streams IS NULL OR array_length(v_streams, 1) IS NULL THEN
    v_streams := ARRAY['*'];
  END IF;

  FOREACH v_stream IN ARRAY v_streams LOOP
    v_row_items := NULL;

    -- Tier 1: tenant-specific, this exact stream.
    SELECT required_items INTO v_row_items
    FROM public.evidence_requirements
    WHERE transport_company_id = p_transport_company_id AND waste_stream = v_stream;

    -- Tier 2: tenant-specific wildcard.
    IF v_row_items IS NULL THEN
      SELECT required_items INTO v_row_items
      FROM public.evidence_requirements
      WHERE transport_company_id = p_transport_company_id AND waste_stream = '*';
    END IF;

    -- Tier 3: global, this exact stream.
    IF v_row_items IS NULL THEN
      SELECT required_items INTO v_row_items
      FROM public.evidence_requirements
      WHERE transport_company_id IS NULL AND waste_stream = v_stream;
    END IF;

    -- Tier 4: global wildcard (always exists — the seeded airtight default).
    IF v_row_items IS NULL THEN
      SELECT required_items INTO v_row_items
      FROM public.evidence_requirements
      WHERE transport_company_id IS NULL AND waste_stream = '*';
    END IF;

    IF v_row_items IS NOT NULL THEN
      v_result := v_result || v_row_items;
    END IF;
  END LOOP;

  RETURN COALESCE(
    (SELECT array_agg(DISTINCT x ORDER BY x) FROM unnest(v_result) AS x),
    '{}'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.resolve_required_evidence(uuid, text[]) TO authenticated;

-- ─────────────────────────────────────────────────────────────
-- B4. pickup_events_before_insert — replaces 021's version in place. Steps
--     1–4c are copied VERBATIM (tenant/FK checks, CP2 operational gate).
--     Step 5 (geofence) is verbatim. Step 5b (QR) is REWRITTEN: HMAC verify
--     + replay check instead of direct equality. Step 6 (risk engine) keeps
--     every existing weight verbatim and adds: qr_token_replayed detail
--     flag, possible_relay_attack (+30), and step 6b (new): required-
--     evidence enforcement, which can force compliance_status to
--     non_compliant independently of risk_score (decision 4 above).
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

  -- (022) QR HMAC verification
  v_qr_parts            text[];
  v_payload_b64         text;
  v_sig_b64             text;
  v_expected_sig        text;
  v_payload_json        jsonb;
  v_qr_branch_id        uuid;
  v_qr_exp_ms           bigint;
  v_qr_ok               boolean := false;
  v_replay               boolean := false;

  -- (022) required-evidence enforcement
  v_required            text[];
  v_missing_required    text[] := '{}';
  v_item                text;
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

  -- 5b. (022) Dynamic branch QR: HMAC-verify against the branch's secret
  -- (branches.qr_token, never displayed to any client — decision 6 above),
  -- check branch match + TTL, then consume the token exactly once via
  -- branch_qr_used_tokens (decision 2 above) — replay fails closed.
  IF NEW.qr_code_value IS NOT NULL THEN
    v_qr_parts := regexp_split_to_array(NEW.qr_code_value, '\.');
    IF array_length(v_qr_parts, 1) = 2 THEN
      v_payload_b64 := v_qr_parts[1];
      v_sig_b64     := v_qr_parts[2];
      BEGIN
        -- hmac() is schema-qualified because this function runs with
        -- search_path='' (decision above re: SECURITY DEFINER hardening),
        -- and pgcrypto installs into the `extensions` schema in this
        -- project, not `public` — an unqualified call here would raise
        -- "function hmac(...) does not exist", which the surrounding
        -- EXCEPTION WHEN OTHERS below would silently swallow as "QR not
        -- verified" for every single token. encode/decode/convert_to/
        -- convert_from need no qualification: they live in pg_catalog,
        -- which Postgres always searches regardless of search_path.
        v_expected_sig := replace(replace(encode(
            extensions.hmac(convert_to(v_payload_b64, 'UTF8'), convert_to(v_branch.qr_token::text, 'UTF8'), 'sha256'),
            'base64'
          ), E'\n', ''), E'\r', '');

        IF v_sig_b64 = v_expected_sig THEN
          v_payload_json := convert_from(decode(v_payload_b64, 'base64'), 'UTF8')::jsonb;
          v_qr_branch_id := (v_payload_json->>'branch_id')::uuid;
          v_qr_exp_ms    := (v_payload_json->>'exp')::bigint;

          IF v_qr_branch_id = NEW.branch_id
             AND v_qr_exp_ms > (extract(epoch FROM now()) * 1000)::bigint
          THEN
            INSERT INTO public.branch_qr_used_tokens (signature, branch_id, expires_at)
            VALUES (v_sig_b64, NEW.branch_id, to_timestamp(v_qr_exp_ms / 1000.0))
            ON CONFLICT (signature) DO NOTHING;
            IF FOUND THEN
              v_qr_ok := true;
            ELSE
              v_replay := true;
            END IF;
          END IF;
        END IF;
      EXCEPTION WHEN OTHERS THEN
        -- Malformed base64/JSON/UUID — fail closed, not verified.
        v_qr_ok := false;
      END;
    END IF;
  END IF;
  NEW.qr_verified := v_qr_ok;

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
    IF v_replay THEN
      v_flags := v_flags || ARRAY['qr_token_replayed'];
    END IF;
  END IF;

  -- (022) A cryptographically valid, non-expired, non-replayed QR from the
  -- wrong location is a relay-attack signal — worse than a bare geofence
  -- miss, so it stacks its own weight on top of geofence_failed rather than
  -- replacing it. A valid QR is never treated as proof of presence alone.
  IF NEW.qr_verified AND NOT NEW.geofence_verified THEN
    v_score := v_score + 30;  v_flags := v_flags || ARRAY['possible_relay_attack'];
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

  -- 6b. (022) Required-evidence enforcement (decision 4 above). Independent
  -- of the numeric score: a required item being absent forces non_compliant
  -- even if v_score would otherwise say 'compliant'.
  v_required := public.resolve_required_evidence(NEW.transport_company_id, NEW.waste_types);

  IF 'qr' = ANY(v_required) AND NOT NEW.qr_verified THEN
    v_missing_required := v_missing_required || ARRAY['qr'];
  END IF;
  IF 'geofenced_gps' = ANY(v_required) AND NOT NEW.geofence_verified THEN
    v_missing_required := v_missing_required || ARRAY['geofenced_gps'];
  END IF;
  IF 'photo' = ANY(v_required) AND NEW.photo_path IS NULL THEN
    v_missing_required := v_missing_required || ARRAY['photo'];
  END IF;
  IF 'signature' = ANY(v_required) AND NEW.signature_path IS NULL THEN
    v_missing_required := v_missing_required || ARRAY['signature'];
  END IF;
  IF 'receipt' = ANY(v_required) AND NEW.receipt_path IS NULL THEN
    v_missing_required := v_missing_required || ARRAY['receipt'];
  END IF;
  IF 'scale_photo' = ANY(v_required) AND NEW.scale_photo_path IS NULL THEN
    v_missing_required := v_missing_required || ARRAY['scale_photo'];
  END IF;

  IF array_length(v_missing_required, 1) > 0 THEN
    v_flags := v_flags || ARRAY['missing_required_evidence'];
    FOREACH v_item IN ARRAY v_missing_required LOOP
      v_flags := v_flags || ARRAY['missing_required:' || v_item];
    END LOOP;
  END IF;

  -- (022) qr_skip_reason visibility — independent of whether qr was
  -- actually required for this event's waste_types.
  IF NEW.qr_skip_reason IS NOT NULL THEN
    v_flags := v_flags || ARRAY['qr_skipped_with_reason'];
    IF 'qr' = ANY(v_required) THEN
      v_flags := v_flags || ARRAY['reduced_verification'];
    END IF;
  END IF;

  NEW.risk_score        := v_score;
  NEW.risk_flags         := v_flags;
  NEW.compliance_status :=
    CASE
      WHEN array_length(v_missing_required, 1) > 0 THEN 'non_compliant'
      WHEN v_score = 0                              THEN 'compliant'
      WHEN v_score <= 39                            THEN 'warning'
      ELSE                                                'non_compliant'
    END;

  RETURN NEW;
END;
$$;
