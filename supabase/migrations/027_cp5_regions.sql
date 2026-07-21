-- ═══════════════════════════════════════════════════════════════════════════
-- Sanad 360 – Migration 027: regions (gov drill-down grain, replacing city
-- free-text for aggregation)
--
-- CP5 item 2: branches.city / facilities.city are free text — can't be
-- GROUP BY'd reliably for the government view's region drill-down (typos,
-- inconsistent spelling, no canonical set). This migration adds a seeded
-- `regions` lookup using the canonical ISO 3166-2:SA codes (Saudi Arabia's
-- 13 administrative regions — the same codes GASTAT/Saudi National Address
-- systems key off), and an optional region_code FK on both branches and
-- facilities. `city` is left completely untouched underneath (still free
-- text, still what's shown in existing UI) — region_code is an additive
-- classification layer for aggregation, not a replacement.
--
-- Codes verified against ISO 3166-2:SA (ISO/Wikipedia), not invented: the
-- numbering deliberately skips 13 (SA-01 through SA-14, no SA-13) — that gap
-- is a real, stable feature of the standard, not an error in this migration.
--
-- Nullable on both branches and facilities: no existing row has a value and
-- there is no true value to backfill (same reasoning as 022's NOT VALID
-- QR-check and 025's companies.industry — no synthetic data manufactured for
-- history). The onboarding forms make it a required field going forward, at
-- the app layer, in the next phase.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE public.regions (
  code        text        PRIMARY KEY,  -- ISO 3166-2:SA, e.g. 'SA-01'
  name_ar     text        NOT NULL,
  name_en     text        NOT NULL,
  sort_order  integer     NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.regions (code, name_ar, name_en, sort_order) VALUES
  ('SA-01', 'الرياض',              'Riyadh',            1),
  ('SA-02', 'مكة المكرمة',          'Makkah',            2),
  ('SA-03', 'المدينة المنورة',      'Madinah',           3),
  ('SA-04', 'المنطقة الشرقية',      'Eastern Province',  4),
  ('SA-05', 'القصيم',              'Qassim',            5),
  ('SA-06', 'حائل',                'Ha''il',            6),
  ('SA-07', 'تبوك',                'Tabuk',             7),
  ('SA-08', 'الحدود الشمالية',      'Northern Borders',  8),
  ('SA-09', 'جازان',               'Jazan',             9),
  ('SA-10', 'نجران',               'Najran',            10),
  ('SA-11', 'الباحة',              'Al Bahah',          11),
  ('SA-12', 'الجوف',               'Al Jouf',           12),
  ('SA-14', 'عسير',                'Asir',              13);

ALTER TABLE public.regions ENABLE ROW LEVEL SECURITY;

CREATE POLICY regions_select ON public.regions
  FOR SELECT TO authenticated
  USING (true);

GRANT SELECT ON public.regions TO authenticated;
GRANT ALL ON public.regions TO service_role;
-- INSERT/UPDATE: service_role only — this is a stable reference list (ISO
-- codes), not a tenant-editable one, same posture as evidence_requirements'
-- global rows.

ALTER TABLE public.branches ADD COLUMN region_code text REFERENCES public.regions(code);
ALTER TABLE public.facilities ADD COLUMN region_code text REFERENCES public.regions(code);

-- Migration 023 restricted branches UPDATE to an explicit column-level
-- GRANT (name_ar, name_en, address_ar, city, geofence_*, status) — additive
-- here, not a rewrite of that grant, so an owner/manager can set their own
-- branch's region without a service_role round-trip.
GRANT UPDATE (region_code) ON public.branches TO authenticated;
-- facilities has no equivalent column-level lockdown — its existing
-- table-level UPDATE grant (if any) already covers new columns; no change
-- needed there. (Region-tagging an existing facility going through
-- recycler-side onboarding is app-code, next phase.)

-- ═══════════════════════════════════════════════════════════════════════════
-- END OF MIGRATION 027
-- ═══════════════════════════════════════════════════════════════════════════
