-- ═══════════════════════════════════════════════════════════════════════════
-- Sanad 360 – Migration 028: industries (seeded bilingual lookup, supersedes
-- 025's placeholder CHECK-list column)
--
-- CP5 item 4: migration 025 added companies.industry as a plain text column
-- with a hardcoded CHECK list, explicitly flagged there as "placeholder
-- values pending product sign-off." The confirmed design is a real seeded
-- lookup table (stable, never-reused codes; bilingual labels; sort_order for
-- the onboarding dropdown; is_active so a code can be retired without
-- breaking every company row still holding it) — not a CHECK list, and not
-- a Postgres ENUM (industry categories are a product classification likely
-- to be tuned over time; a CHECK-list-in-a-table can be widened with a plain
-- INSERT, none of the ADD-VALUE-in-its-own-transaction ceremony a real enum
-- would require for what's expected to be a living list — same reasoning
-- 025 already gave for choosing CHECK-list over ENUM, just now correctly
-- externalized into its own table instead of inlined on companies).
--
-- No company row has ever had industry set (025 shipped it nullable, no
-- onboarding UI wired it yet) — this migration replaces the column in place
-- (rename + FK) rather than a risky drop/recreate; there is no data to
-- migrate.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE public.industries (
  code        text        PRIMARY KEY,
  label_ar    text        NOT NULL,
  label_en    text        NOT NULL,
  sort_order  integer     NOT NULL DEFAULT 0,
  is_active   boolean     NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.industries (code, label_ar, label_en, sort_order) VALUES
  ('healthcare',                'الرعاية الصحية',           'Healthcare',                    1),
  ('manufacturing',             'التصنيع',                  'Manufacturing',                 2),
  ('food_beverage',             'الأغذية والمشروبات',       'Food & Beverage',               3),
  ('retail',                    'التجزئة',                  'Retail',                        4),
  ('hospitality',                'الضيافة',                  'Hospitality',                   5),
  ('construction_demolition',   'البناء والهدم',            'Construction & Demolition',     6),
  ('oil_gas_petrochem',         'النفط والغاز والبتروكيماويات', 'Oil, Gas & Petrochemicals', 7),
  ('education',                 'التعليم',                  'Education',                     8),
  ('government_public',         'الحكومي والعام',           'Government & Public Sector',    9),
  ('logistics_warehousing',     'الخدمات اللوجستية والمستودعات', 'Logistics & Warehousing',  10),
  ('automotive_workshops',      'ورش السيارات',             'Automotive Workshops',          11),
  ('agriculture',               'الزراعة',                  'Agriculture',                   12),
  ('offices_commercial',        'المكاتب والأنشطة التجارية', 'Offices & Commercial',          13),
  ('other',                     'أخرى',                     'Other',                         14);

ALTER TABLE public.industries ENABLE ROW LEVEL SECURITY;

CREATE POLICY industries_select ON public.industries
  FOR SELECT TO authenticated
  USING (is_active OR (public.my_membership()).role = 'admin');

GRANT SELECT ON public.industries TO authenticated;
GRANT ALL ON public.industries TO service_role;
-- INSERT/UPDATE: service_role / admin console only.

-- Supersede 025's placeholder: drop its CHECK, rename the column in place,
-- point it at the new lookup table instead.
ALTER TABLE public.companies DROP CONSTRAINT companies_industry_check;
ALTER TABLE public.companies RENAME COLUMN industry TO industry_code;
ALTER TABLE public.companies ADD CONSTRAINT companies_industry_code_fkey
  FOREIGN KEY (industry_code) REFERENCES public.industries(code);

-- ═══════════════════════════════════════════════════════════════════════════
-- END OF MIGRATION 028
-- ═══════════════════════════════════════════════════════════════════════════
