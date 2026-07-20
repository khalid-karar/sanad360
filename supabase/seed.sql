-- ═══════════════════════════════════════════════════════════════════════════
-- Sanad 360 – Dev Seed
-- Creates: 1 company, 1 branch, 1 transport company, 1 driver record,
--          1 vehicle, 4 auth users, 4 memberships.
--
-- Credentials (local dev only — never use in production):
--   Company manager:   manager@sanad360.dev / DevPass1234!
--   Driver:            0501234567@driver.sanad360.com / DevPass1234!
--   Dispatcher:        dispatcher@sanad360.dev / DevPass1234!
--   Admin:             admin@sanad360.dev / DevPass1234!
--   Recycler manager:  recycler.manager@sanad360.dev / DevPass1234!  (CP1)
--   Scale operator:    scale.operator@sanad360.dev / DevPass1234!   (CP1)
-- ═══════════════════════════════════════════════════════════════════════════

-- Fixed UUIDs make this seed idempotent and test-referenceable.
DO $$
BEGIN

-- ─────────────────────────────────────────────────────────────
-- AUTH USERS  (insert into Supabase internal auth schema)
-- Passwords are bcrypt-hashed via pgcrypto (enabled by default).
-- ─────────────────────────────────────────────────────────────
INSERT INTO auth.users (
  instance_id, id, aud, role, email,
  encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
) VALUES
(
  '00000000-0000-0000-0000-000000000000',
  'f0000000-0000-0000-0000-000000000001',
  'authenticated', 'authenticated',
  'manager@sanad360.dev',
  crypt('DevPass1234!', gen_salt('bf')),
  now(),
  '{"provider":"email","providers":["email"]}',
  '{"name_ar":"مدير الشركة"}',
  now(), now(), '', '', '', ''
),
(
  '00000000-0000-0000-0000-000000000000',
  'f0000000-0000-0000-0000-000000000002',
  'authenticated', 'authenticated',
  '0501234567@driver.sanad360.com',
  crypt('DevPass1234!', gen_salt('bf')),
  now(),
  '{"provider":"email","providers":["email"]}',
  '{"name_ar":"محمد بن عبدالله الغامدي","phone":"0501234567"}',
  now(), now(), '', '', '', ''
),
(
  '00000000-0000-0000-0000-000000000000',
  'f0000000-0000-0000-0000-000000000003',
  'authenticated', 'authenticated',
  'dispatcher@sanad360.dev',
  crypt('DevPass1234!', gen_salt('bf')),
  now(),
  '{"provider":"email","providers":["email"]}',
  '{"name_ar":"مشرف التوزيع"}',
  now(), now(), '', '', '', ''
),
(
  '00000000-0000-0000-0000-000000000000',
  'f0000000-0000-0000-0000-000000000004',
  'authenticated', 'authenticated',
  'admin@sanad360.dev',
  crypt('DevPass1234!', gen_salt('bf')),
  now(),
  '{"provider":"email","providers":["email"]}',
  '{"name_ar":"مدير النظام"}',
  now(), now(), '', '', '', ''
),
-- CP1: recycler-side users (facility tenant)
(
  '00000000-0000-0000-0000-000000000000',
  'f0000000-0000-0000-0000-000000000005',
  'authenticated', 'authenticated',
  'recycler.manager@sanad360.dev',
  crypt('DevPass1234!', gen_salt('bf')),
  now(),
  '{"provider":"email","providers":["email"]}',
  '{"name_ar":"مدير منشأة إعادة التدوير"}',
  now(), now(), '', '', '', ''
),
(
  '00000000-0000-0000-0000-000000000000',
  'f0000000-0000-0000-0000-000000000006',
  'authenticated', 'authenticated',
  'scale.operator@sanad360.dev',
  crypt('DevPass1234!', gen_salt('bf')),
  now(),
  '{"provider":"email","providers":["email"]}',
  '{"name_ar":"مشغّل الميزان"}',
  now(), now(), '', '', '', ''
)
ON CONFLICT (id) DO NOTHING;

-- Auth identities (required for email/password login)
INSERT INTO auth.identities (
  id, user_id, provider_id, identity_data, provider,
  last_sign_in_at, created_at, updated_at
) VALUES
(
  'f0000000-0000-0000-0000-000000000001',
  'f0000000-0000-0000-0000-000000000001',
  'manager@sanad360.dev',
  '{"sub":"f0000000-0000-0000-0000-000000000001","email":"manager@sanad360.dev"}'::jsonb,
  'email', now(), now(), now()
),
(
  'f0000000-0000-0000-0000-000000000002',
  'f0000000-0000-0000-0000-000000000002',
  '0501234567@driver.sanad360.com',
  '{"sub":"f0000000-0000-0000-0000-000000000002","email":"0501234567@driver.sanad360.com"}'::jsonb,
  'email', now(), now(), now()
),
(
  'f0000000-0000-0000-0000-000000000003',
  'f0000000-0000-0000-0000-000000000003',
  'dispatcher@sanad360.dev',
  '{"sub":"f0000000-0000-0000-0000-000000000003","email":"dispatcher@sanad360.dev"}'::jsonb,
  'email', now(), now(), now()
),
(
  'f0000000-0000-0000-0000-000000000004',
  'f0000000-0000-0000-0000-000000000004',
  'admin@sanad360.dev',
  '{"sub":"f0000000-0000-0000-0000-000000000004","email":"admin@sanad360.dev"}'::jsonb,
  'email', now(), now(), now()
),
(
  'f0000000-0000-0000-0000-000000000005',
  'f0000000-0000-0000-0000-000000000005',
  'recycler.manager@sanad360.dev',
  '{"sub":"f0000000-0000-0000-0000-000000000005","email":"recycler.manager@sanad360.dev"}'::jsonb,
  'email', now(), now(), now()
),
(
  'f0000000-0000-0000-0000-000000000006',
  'f0000000-0000-0000-0000-000000000006',
  'scale.operator@sanad360.dev',
  '{"sub":"f0000000-0000-0000-0000-000000000006","email":"scale.operator@sanad360.dev"}'::jsonb,
  'email', now(), now(), now()
)
ON CONFLICT (id) DO NOTHING;

-- ─────────────────────────────────────────────────────────────
-- PROFILES  (handle_new_user trigger fires on auth.users insert,
--            but we also upsert here in case seed order differs)
-- ─────────────────────────────────────────────────────────────
INSERT INTO public.profiles (id, name_ar, name_en, phone)
VALUES
(
  'f0000000-0000-0000-0000-000000000001',
  'مدير الشركة', 'Company Manager', NULL
),
(
  'f0000000-0000-0000-0000-000000000002',
  'محمد بن عبدالله الغامدي', 'Mohammed Abdullah Al-Ghamdi', '0501234567'
),
(
  'f0000000-0000-0000-0000-000000000003',
  'مشرف التوزيع', 'Dispatcher', NULL
),
(
  'f0000000-0000-0000-0000-000000000004',
  'مدير النظام', 'System Admin', NULL
),
(
  'f0000000-0000-0000-0000-000000000005',
  'مدير منشأة إعادة التدوير', 'Recycler Manager', NULL
),
(
  'f0000000-0000-0000-0000-000000000006',
  'مشغّل الميزان', 'Scale Operator', NULL
)
ON CONFLICT (id) DO NOTHING;

-- ─────────────────────────────────────────────────────────────
-- COMPANY
-- ─────────────────────────────────────────────────────────────
INSERT INTO public.companies (id, name_ar, name_en, commercial_registration)
VALUES (
  'a0000000-0000-0000-0000-000000000001',
  'شركة الأمل للأغذية',
  'Al-Amal Food Company',
  '1010000001'
)
ON CONFLICT (id) DO NOTHING;

-- ─────────────────────────────────────────────────────────────
-- BRANCH  (Riyadh – Al-Olaya district, geofence 150 m)
-- ─────────────────────────────────────────────────────────────
INSERT INTO public.branches (
  id, company_id, name_ar, name_en,
  address_ar, city,
  geofence_lat, geofence_lng, geofence_radius_m
)
VALUES (
  'b0000000-0000-0000-0000-000000000001',
  'a0000000-0000-0000-0000-000000000001',
  'فرع الرياض - حي العليا',
  'Riyadh Branch - Al-Olaya District',
  'شارع العليا، حي العليا، الرياض',
  'Riyadh',
  24.6877,  -- latitude (Al-Olaya, Riyadh)
  46.6876,  -- longitude
  150       -- metres
)
ON CONFLICT (id) DO NOTHING;

-- ─────────────────────────────────────────────────────────────
-- TRANSPORT COMPANY
-- ─────────────────────────────────────────────────────────────
INSERT INTO public.transport_companies (
  id, name_ar, name_en,
  commercial_registration,
  ncwm_license_number,
  ncwm_license_expiry
)
VALUES (
  'c0000000-0000-0000-0000-000000000001',
  'شركة سند للنقل المتكامل',
  'Sanad Integrated Transport',
  '1010000002',
  'NCWM-2024-001',
  '2026-12-31'
)
ON CONFLICT (id) DO NOTHING;

-- Additional transport companies — NOT linked to the seeded company, so they
-- appear as available options in the "Add Transporter" modal (Bug/Seed 5).
INSERT INTO public.transport_companies (
  id, name_ar, name_en,
  commercial_registration,
  ncwm_license_number,
  ncwm_license_expiry
)
VALUES
(
  'c0000000-0000-0000-0000-000000000002',
  'شركة الخليج للنقل البيئي',
  'Gulf Environmental Transport',
  '1010000003',
  'NCWM-2024-002',
  '2026-12-31'
),
(
  'c0000000-0000-0000-0000-000000000003',
  'مؤسسة النقل الأخضر',
  'Green Transport Est.',
  '1010000004',
  'NCWM-2024-003',
  '2027-06-30'
)
ON CONFLICT (id) DO NOTHING;

-- ─────────────────────────────────────────────────────────────
-- DRIVER RECORD  (links to driver auth user via profile_id)
-- ─────────────────────────────────────────────────────────────
INSERT INTO public.drivers (
  id, transport_company_id, profile_id,
  name_ar, license_number, license_expiry,
  absher_verified, status
)
VALUES (
  'd0000000-0000-0000-0000-000000000001',
  'c0000000-0000-0000-0000-000000000001',
  'f0000000-0000-0000-0000-000000000002',  -- driver auth user
  'محمد بن عبدالله الغامدي',
  'SA-2024-001',
  '2027-06-30',
  true,
  'active'
)
ON CONFLICT (id) DO NOTHING;

-- ─────────────────────────────────────────────────────────────
-- VEHICLE
-- ─────────────────────────────────────────────────────────────
INSERT INTO public.vehicles (
  id, transport_company_id,
  plate_number, type,
  waste_license_type,
  ncwm_license_number,
  ncwm_license_expiry,
  status
)
VALUES (
  'e0000000-0000-0000-0000-000000000001',
  'c0000000-0000-0000-0000-000000000001',
  'أ ب ج 1234',
  'medium_truck',
  'general',
  'VEH-NCWM-001',
  '2026-09-30',
  'active'
)
ON CONFLICT (id) DO NOTHING;

-- ─────────────────────────────────────────────────────────────
-- FACILITY  (CP1: recycling plant — Riyadh industrial zone)
-- ─────────────────────────────────────────────────────────────
INSERT INTO public.facilities (
  id, name_ar, name_en, license_number, license_expiry, city,
  geofence_lat, geofence_lng, geofence_radius_m
)
VALUES (
  '90000000-0000-0000-0000-000000000001',
  'منشأة الرياض لإعادة التدوير',
  'Riyadh Recycling Facility',
  'MWAN-90001',
  '2027-12-31',
  'Riyadh',
  24.6408,   -- Second Industrial City, Riyadh (approx.)
  46.7728,
  200
)
ON CONFLICT (id) DO NOTHING;

-- Link the seeded facility to the seeded transport company (gates trip creation).
INSERT INTO public.facility_transporters (id, facility_id, transport_company_id, status)
VALUES (
  'f2000000-0000-0000-0000-000000000001',
  '90000000-0000-0000-0000-000000000001',
  'c0000000-0000-0000-0000-000000000001',
  'active'
)
ON CONFLICT (id) DO NOTHING;

-- ─────────────────────────────────────────────────────────────
-- MEMBERSHIPS
-- ─────────────────────────────────────────────────────────────
INSERT INTO public.memberships (
  id, user_id, role,
  company_id, transport_company_id, branch_id, facility_id
)
VALUES
(
  '10000000-0000-0000-0000-000000000001',
  'f0000000-0000-0000-0000-000000000001',  -- manager auth user
  'manager',
  'a0000000-0000-0000-0000-000000000001',  -- company
  NULL,
  'b0000000-0000-0000-0000-000000000001',  -- pinned to branch
  NULL
),
(
  '10000000-0000-0000-0000-000000000002',
  'f0000000-0000-0000-0000-000000000002',  -- driver auth user
  'driver',
  NULL,
  'c0000000-0000-0000-0000-000000000001',  -- transport company
  'b0000000-0000-0000-0000-000000000001',  -- default branch to serve
  NULL
),
(
  '10000000-0000-0000-0000-000000000003',
  'f0000000-0000-0000-0000-000000000003',  -- dispatcher auth user
  'dispatcher',
  NULL,
  'c0000000-0000-0000-0000-000000000001',  -- transport company
  NULL,
  NULL
),
(
  '10000000-0000-0000-0000-000000000004',
  'f0000000-0000-0000-0000-000000000004',  -- admin auth user
  'admin',
  NULL,   -- no tenant — admin sees all
  NULL,
  NULL,
  NULL
),
(
  '10000000-0000-0000-0000-000000000005',
  'f0000000-0000-0000-0000-000000000005',  -- recycler manager auth user
  'recycler_manager',
  NULL,
  NULL,
  NULL,
  '90000000-0000-0000-0000-000000000001'   -- facility
),
(
  '10000000-0000-0000-0000-000000000006',
  'f0000000-0000-0000-0000-000000000006',  -- scale operator auth user
  'scale_operator',
  NULL,
  NULL,
  NULL,
  '90000000-0000-0000-0000-000000000001'   -- facility
)
ON CONFLICT (id) DO NOTHING;

-- ─────────────────────────────────────────────────────────────
-- COMPANY ↔ TRANSPORTER LINK
-- Link seeded company to seeded transport company
-- ─────────────────────────────────────────────────────────────
INSERT INTO public.company_transporters (id, company_id, transport_company_id, status)
VALUES (
  'f1000000-0000-0000-0000-000000000001',
  'a0000000-0000-0000-0000-000000000001',  -- seeded company
  'c0000000-0000-0000-0000-000000000001',  -- seeded transport company
  'active'
)
ON CONFLICT (id) DO NOTHING;

END $$;
