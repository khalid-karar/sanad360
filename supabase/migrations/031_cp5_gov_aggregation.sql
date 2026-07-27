-- ═══════════════════════════════════════════════════════════════════════════
-- Sanad 360 – Migration 031: government aggregation (k-anonymity, aggregates
-- only, never raw driver/company PII)
--
-- CP5 item: gov_viewer's region -> industry -> facility -> transporter
-- drill-down. This migration is the ENTIRE data-access surface gov_viewer
-- will ever have — no new RLS bypass is added to pickup_events, companies,
-- drivers, or any other PII-bearing table for this role. gov_viewer's
-- membership shape (all-null company_id/transport_company_id/facility_id,
-- widened into one_tenant by 025) already means every EXISTING RLS policy
-- in the schema excludes it by construction (no policy anywhere has a
-- `role = 'gov_viewer'` bypass, and none of its membership columns can
-- match a tenant-scoped USING clause) — confirmed by the test in this
-- migration's companion test file, not merely assumed. The only path
-- gov_viewer has to ANY pickup data is gov_rollup() below, a SECURITY
-- DEFINER function that reads the raw tables internally but returns ONLY
-- suppressed-or-aggregated rows, with its own explicit role gate (it cannot
-- rely on RLS for authorization, since SECURITY DEFINER runs with the
-- function owner's privileges — the role check is done in the function
-- body itself, the same posture PDF-service admin endpoints already use
-- for JWT+role checks, just enforced in SQL here instead of Express).
--
-- ─────────────────────────────────────────────────────────────
-- K-ANONYMITY / DIFFERENCING PROTECTION — the actual hard requirement
-- ─────────────────────────────────────────────────────────────
-- Threshold (config, not hardcoded): gov_aggregation_policy.min_companies,
-- a singleton row (default 5). A cell is PRIMARILY suppressed whenever the
-- number of DISTINCT GENERATOR COMPANIES contributing to it is below this
-- threshold — not pickup count, not weight. This is deliberate: showing
-- "3 companies, compliance breakdown X" for a named facility/transporter
-- would still identify those specific companies' compliance profile even
-- though no company NAME is shown, precisely because so few of them exist
-- in that cell. Applies at EVERY level, including the root (national)
-- aggregate and the deepest (transporter) leaf.
--
-- DIFFERENCING GUARD: within a fixed parent path, every returned child
-- exhaustively partitions the parent's pickups (see the "unassigned"
-- bucket note below — partition completeness is what makes this argument
-- valid). additive metrics (pickup counts, weight, compliance-status
-- counts) therefore sum EXACTLY across siblings to the parent's total. If
-- exactly ONE sibling is primarily suppressed while the rest (and the
-- parent) are visible, that one sibling's numbers are recoverable by
-- subtracting the visible siblings from the parent total — a textbook
-- differencing attack. Fix (standard statistical-disclosure-control
-- "complementary/secondary suppression"): when exactly one sibling is
-- primarily suppressed, ALSO suppress the smallest-by-company-count VISIBLE
-- sibling, so at least two unknowns share one equation (parent_total =
-- sum of suppressed siblings) and neither is individually solvable. Zero
-- or two-plus primary suppressions at a given level need no further action
-- (zero: nothing to protect; two-plus: already only the SUM of the
-- suppressed group is inferable, never an individual cell — accepted
-- residual, matching the literal ask: protect against recovering "a
-- suppressed cell" via subtraction).
--
-- PARENT SHORT-CIRCUIT: the set of companies contributing to any child cell
-- is always a SUBSET of the set contributing to its parent cell (a company
-- satisfying every parent filter PLUS one more filter is still a parent
-- contributor) — true regardless of overlap between siblings. So if a
-- parent's own distinct-company-count is below threshold, EVERY child is
-- guaranteed to be at or below that same count, hence also suppressed.
-- gov_rollup() short-circuits in this case: zero child rows are computed or
-- returned, all provably suppressed without needing to touch the data twice.
--
-- COMPLETENESS ("unassigned" buckets): a pickup can lack a region (branch
-- never assigned one — region_code is nullable, added by 027 with no
-- backfill), an industry (company never assigned one — same story, 028),
-- or a facility (not yet grouped into a trip). Excluding these rows from
-- the returned child set would silently break the exhaustive-partition
-- property the differencing guard depends on (parent_total would then
-- exceed the sum of shown children by exactly the excluded amount — which,
-- if there also happened to be only one OTHER real child, would leak that
-- child's value through the same subtraction). So every level returns an
-- explicit "unassigned/unclassified" row (group_key NULL) as a first-class
-- sibling, subject to the exact same threshold and complementary-suppression
-- rules as every other row — never silently dropped.
--
-- SCOPE BOUNDARY (stated plainly): this defends against direct parent-
-- children differencing within ONE drill-down path — the specific attack
-- CP5 asked to guard against. It does not attempt general statistical-
-- disclosure control against correlating MULTIPLE different drill-down
-- queries against each other (e.g., cross-referencing a region+industry
-- view against a region+facility view to over-constrain a shared unknown).
-- Real statistical agencies use dedicated SDC software for that broader
-- problem; solving it generally here would be substantial, separate scope.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────
-- A. gov_aggregation_policy — singleton config (the `boolean PRIMARY KEY
--    DEFAULT true CHECK (id)` idiom guarantees exactly one row, ever).
-- ─────────────────────────────────────────────────────────────
CREATE TABLE public.gov_aggregation_policy (
  id             boolean     PRIMARY KEY DEFAULT true CHECK (id),
  min_companies  integer     NOT NULL CHECK (min_companies > 0),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.gov_aggregation_policy (id, min_companies) VALUES (true, 5);

ALTER TABLE public.gov_aggregation_policy ENABLE ROW LEVEL SECURITY;

CREATE POLICY gov_aggregation_policy_select ON public.gov_aggregation_policy
  FOR SELECT TO authenticated
  USING (true);

GRANT SELECT ON public.gov_aggregation_policy TO authenticated;
GRANT ALL ON public.gov_aggregation_policy TO service_role;
-- UPDATE/INSERT/DELETE: service_role / admin console only — same posture as
-- every other config table in this migration family. No authenticated
-- write path at all (unlike 029's memberships table, where a narrow
-- authenticated path was genuinely wanted) — changing the anonymity
-- threshold is a governance decision, not a self-service one.

-- ─────────────────────────────────────────────────────────────
-- B. gov_rollup — the entire gov_viewer data-access surface.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.gov_rollup(
  p_region_code text DEFAULT NULL,
  p_industry_code text DEFAULT NULL,
  p_facility_id uuid DEFAULT NULL
)
RETURNS TABLE (
  level                       text,
  group_key                   text,
  label_ar                    text,
  label_en                    text,
  is_suppressed               boolean,
  n_companies                 integer,
  total_pickups               integer,
  total_weight_kg             numeric,
  compliant_count             integer,
  warning_count               integer,
  non_compliant_count         integer,
  pending_confirmation_count  integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_level        text;
  v_min_companies integer;
  v_parent_n_companies integer;
BEGIN
  -- Explicit role gate — SECURITY DEFINER bypasses RLS entirely, so this
  -- function IS the authorization check, not a convenience on top of one.
  -- NOT (... IN (...)) is NULL, not TRUE, when the left side is NULL (no
  -- membership at all, e.g. an unauthenticated/service-level caller with no
  -- auth.uid()) — and `IF NULL THEN` never executes in PL/pgSQL, so a naive
  -- `IF role NOT IN (...)` SILENTLY ADMITS a caller with no membership.
  -- Confirmed by hand while validating this migration. COALESCE forces the
  -- NULL case to deny, not admit.
  IF COALESCE((public.my_membership()).role::text NOT IN ('gov_viewer', 'admin', 'super_admin'), true) THEN
    RAISE EXCEPTION 'FORBIDDEN: gov_rollup is restricted to gov_viewer/admin/super_admin'
      USING ERRCODE = '42501';
  END IF;

  v_level := CASE
    WHEN p_region_code IS NULL THEN 'region'
    WHEN p_industry_code IS NULL THEN 'industry'
    WHEN p_facility_id IS NULL THEN 'facility'
    ELSE 'transporter'
  END;

  SELECT gap.min_companies INTO v_min_companies FROM public.gov_aggregation_policy gap LIMIT 1;

  -- Parent short-circuit: if the parent path itself doesn't meet threshold,
  -- every child is guaranteed to be at or below it too (subset argument in
  -- the header) — return zero rows without touching pickup data twice.
  SELECT count(DISTINCT pe.company_id) INTO v_parent_n_companies
  FROM public.pickup_events pe
  JOIN public.branches b ON b.id = pe.branch_id
  JOIN public.companies c ON c.id = pe.company_id
  LEFT JOIN public.trips t ON t.id = pe.trip_id
  WHERE (p_region_code   IS NULL OR b.region_code = p_region_code)
    AND (p_industry_code IS NULL OR c.industry_code = p_industry_code)
    AND (p_facility_id   IS NULL OR t.planned_facility_id = p_facility_id);

  IF v_parent_n_companies < v_min_companies THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH pickups AS (
    SELECT
      pe.id, pe.company_id, pe.weight_kg, pe.compliance_status,
      pe.transport_company_id,
      b.region_code,
      c.industry_code,
      t.planned_facility_id AS facility_id
    FROM public.pickup_events pe
    JOIN public.branches b ON b.id = pe.branch_id
    JOIN public.companies c ON c.id = pe.company_id
    LEFT JOIN public.trips t ON t.id = pe.trip_id
    WHERE (p_region_code   IS NULL OR b.region_code = p_region_code)
      AND (p_industry_code IS NULL OR c.industry_code = p_industry_code)
      AND (p_facility_id   IS NULL OR t.planned_facility_id = p_facility_id)
  ),
  -- The grouping key for the NEXT drill-down level. NULL group keys
  -- ("unassigned") are kept as a first-class row, never excluded — see
  -- header on why partition completeness matters for the differencing guard.
  children_raw AS (
    SELECT
      CASE
        WHEN p_region_code IS NULL THEN region_code
        WHEN p_industry_code IS NULL THEN industry_code
        WHEN p_facility_id IS NULL THEN facility_id::text
        ELSE transport_company_id::text
      END AS group_key,
      count(DISTINCT company_id)::integer AS co_count,
      count(*)::integer AS pickup_count,
      sum(weight_kg) AS weight_sum,
      count(*) FILTER (WHERE compliance_status = 'compliant')::integer AS compliant_ct,
      count(*) FILTER (WHERE compliance_status = 'warning')::integer AS warning_ct,
      count(*) FILTER (WHERE compliance_status = 'non_compliant')::integer AS non_compliant_ct,
      count(*) FILTER (WHERE compliance_status = 'pending_confirmation')::integer AS pending_confirmation_ct
    FROM pickups
    GROUP BY
      CASE
        WHEN p_region_code IS NULL THEN region_code
        WHEN p_industry_code IS NULL THEN industry_code
        WHEN p_facility_id IS NULL THEN facility_id::text
        ELSE transport_company_id::text
      END
  ),
  -- Internal column names deliberately differ from the function's OUT
  -- parameter names (n_companies, total_pickups, ...) — PL/pgSQL binds OUT
  -- parameters as visible identifiers inside the function body, and an
  -- identically-named CTE column is genuinely ambiguous to the parser, not
  -- just a style nit (confirmed: this fails to even compile otherwise).
  primary_flagged AS (
    SELECT cr.*, (cr.co_count < v_min_companies) AS primary_suppressed
    FROM children_raw cr
  ),
  suppression_meta AS (
    SELECT
      pf.*,
      count(*) FILTER (WHERE primary_suppressed) OVER () AS n_suppressed_total,
      -- row_number() has no FILTER form (that's aggregate-only) — instead
      -- partition by primary_suppressed so each partition ranks separately;
      -- only the primary_suppressed=false partition's rank 1 (smallest
      -- co_count among VISIBLE siblings) is ever consulted below.
      --
      -- Secondary sort key (group_key) is NOT cosmetic: ORDER BY co_count
      -- ASC alone is ambiguous whenever two siblings tie on company count,
      -- and Postgres does not guarantee a stable row order for ties absent
      -- an explicit tiebreak — which sibling gets sacrificed could vary
      -- across calls/plans. group_key (region_code / industry_code /
      -- facility_id::text / transport_company_id::text) is always present
      -- and unique per row, making the tiebreak, and therefore which cell
      -- is sacrificed, deterministic call after call.
      -- pf.group_key (not bare group_key) — bare would be ambiguous against
      -- the function's own `group_key` OUT parameter, exactly like co_count
      -- et al. above; qualifying with the CTE alias resolves it to the
      -- column, not the OUT parameter.
      row_number() OVER (PARTITION BY primary_suppressed ORDER BY co_count ASC, pf.group_key ASC) AS visible_rank_smallest
    FROM primary_flagged pf
  ),
  final_rows AS (
    SELECT
      sm.group_key,
      (sm.primary_suppressed
        OR (sm.n_suppressed_total = 1 AND NOT sm.primary_suppressed AND sm.visible_rank_smallest = 1)
      ) AS is_suppressed,
      sm.co_count, sm.pickup_count, sm.weight_sum,
      sm.compliant_ct, sm.warning_ct, sm.non_compliant_ct, sm.pending_confirmation_ct
    FROM suppression_meta sm
  )
  SELECT
    v_level,
    fr.group_key,
    CASE v_level
      WHEN 'region'      THEN COALESCE(r.name_ar, 'غير محدد')
      WHEN 'industry'    THEN COALESCE(ind.label_ar, 'غير مصنّف')
      WHEN 'facility'    THEN COALESCE(f.name_ar, 'لم يُجمَّع ضمن رحلة بعد')
      WHEN 'transporter' THEN COALESCE(tc.name_ar, 'غير معروف')
    END AS label_ar,
    CASE v_level
      WHEN 'region'      THEN COALESCE(r.name_en, 'Unassigned')
      WHEN 'industry'    THEN COALESCE(ind.label_en, 'Unclassified')
      WHEN 'facility'    THEN COALESCE(f.name_en, 'Not yet grouped into a trip')
      WHEN 'transporter' THEN COALESCE(tc.name_en, 'Unknown')
    END AS label_en,
    fr.is_suppressed,
    -- Never the underlying numbers for a suppressed cell — NULLed, not
    -- zero, not omitted (item d: renders as "insufficient data", not zero).
    CASE WHEN fr.is_suppressed THEN NULL ELSE fr.co_count END,
    CASE WHEN fr.is_suppressed THEN NULL ELSE fr.pickup_count END,
    CASE WHEN fr.is_suppressed THEN NULL ELSE fr.weight_sum END,
    CASE WHEN fr.is_suppressed THEN NULL ELSE fr.compliant_ct END,
    CASE WHEN fr.is_suppressed THEN NULL ELSE fr.warning_ct END,
    CASE WHEN fr.is_suppressed THEN NULL ELSE fr.non_compliant_ct END,
    CASE WHEN fr.is_suppressed THEN NULL ELSE fr.pending_confirmation_ct END
  FROM final_rows fr
  LEFT JOIN public.regions r            ON v_level = 'region'      AND r.code = fr.group_key
  LEFT JOIN public.industries ind       ON v_level = 'industry'    AND ind.code = fr.group_key
  LEFT JOIN public.facilities f         ON v_level = 'facility'    AND f.id::text = fr.group_key
  LEFT JOIN public.transport_companies tc ON v_level = 'transporter' AND tc.id::text = fr.group_key;
END;
$$;

-- Callable by any authenticated role — the function's OWN body is the
-- authorization gate (see above), not this GRANT. Table-level EXECUTE
-- grants in Postgres cannot express "only if my_membership().role = X";
-- that check has to live inside the function.
GRANT EXECUTE ON FUNCTION public.gov_rollup(text, text, uuid) TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- END OF MIGRATION 031
-- ═══════════════════════════════════════════════════════════════════════════
