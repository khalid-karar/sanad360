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
--   Transport manager: transport.manager@sanad360.dev / DevPass1234!
--     (no transport-side 'owner'/'manager' was previously seeded — only
--      'driver' and 'dispatcher' — so the owner/manager-gated Add Vehicle /
--      Deactivate actions could never be exercised against seed data)
--   Document reviewer: reviewer@sanad360.dev / DevPass1234!  (CP2)
--
-- CP2 demo documents: the seeded company/branch/transport company/facility
-- each have every required document verified (100% completion, ACTIVE) so
-- the onboarding screens show a healthy tenant by default. The seeded
-- driver's driving licence is verified but expires in ~10 days (demonstrates
-- the 30/15/7-day expiry warning). The seeded vehicle's NCWM licence is
-- REJECTED (demonstrates the restriction banner + resolve flow).
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
),
(
  '00000000-0000-0000-0000-000000000000',
  'f0000000-0000-0000-0000-000000000007',
  'authenticated', 'authenticated',
  'transport.manager@sanad360.dev',
  crypt('DevPass1234!', gen_salt('bf')),
  now(),
  '{"provider":"email","providers":["email"]}',
  '{"name_ar":"مدير شركة النقل"}',
  now(), now(), '', '', '', ''
),
-- CP2: tenant-less document reviewer
(
  '00000000-0000-0000-0000-000000000000',
  'f0000000-0000-0000-0000-000000000008',
  'authenticated', 'authenticated',
  'reviewer@sanad360.dev',
  crypt('DevPass1234!', gen_salt('bf')),
  now(),
  '{"provider":"email","providers":["email"]}',
  '{"name_ar":"مراجع المستندات"}',
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
),
(
  'f0000000-0000-0000-0000-000000000007',
  'f0000000-0000-0000-0000-000000000007',
  'transport.manager@sanad360.dev',
  '{"sub":"f0000000-0000-0000-0000-000000000007","email":"transport.manager@sanad360.dev"}'::jsonb,
  'email', now(), now(), now()
),
(
  'f0000000-0000-0000-0000-000000000008',
  'f0000000-0000-0000-0000-000000000008',
  'reviewer@sanad360.dev',
  '{"sub":"f0000000-0000-0000-0000-000000000008","email":"reviewer@sanad360.dev"}'::jsonb,
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
),
(
  'f0000000-0000-0000-0000-000000000007',
  'مدير شركة النقل', 'Transport Manager', NULL
),
(
  'f0000000-0000-0000-0000-000000000008',
  'مراجع المستندات', 'Document Reviewer', NULL
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

-- CP2: the seeded driver/vehicle represent this dev tenant's fleet as it
-- existed the moment CP2 landed — exactly the population migration 021's
-- compliance_exempt backfill grandfathers in a real deployment. A fresh
-- `supabase db reset` always applies migrations before this seed file, so
-- without this explicit step these rows would look "new" to the gate
-- (compliance_exempt defaults to false, forced by the lock trigger) and
-- every other test/demo relying on this driver/vehicle being schedulable
-- would break. Same disable/enable-trigger technique as the documents
-- block below — the lock trigger intentionally blocks every other path.
ALTER TABLE public.drivers  DISABLE TRIGGER drivers_lock_compliance_exempt_trigger;
ALTER TABLE public.vehicles DISABLE TRIGGER vehicles_lock_compliance_exempt_trigger;
UPDATE public.drivers  SET compliance_exempt = true WHERE id = 'd0000000-0000-0000-0000-000000000001';
UPDATE public.vehicles SET compliance_exempt = true WHERE id = 'e0000000-0000-0000-0000-000000000001';
ALTER TABLE public.drivers  ENABLE TRIGGER drivers_lock_compliance_exempt_trigger;
ALTER TABLE public.vehicles ENABLE TRIGGER vehicles_lock_compliance_exempt_trigger;

-- CP8 D2 (migration 042): same grandfather treatment for the seeded
-- company + all three seeded transport_companies — otherwise the new
-- tenant-wide document gate blocks every pickup_assignment/trip/
-- pickup_event demo/test flow scoped to this dev tenant.
ALTER TABLE public.companies           DISABLE TRIGGER companies_lock_compliance_exempt_trigger;
ALTER TABLE public.transport_companies DISABLE TRIGGER transport_companies_lock_compliance_exempt_trigger;
UPDATE public.companies SET compliance_exempt = true
  WHERE id = 'a0000000-0000-0000-0000-000000000001';
UPDATE public.transport_companies SET compliance_exempt = true
  WHERE id IN (
    'c0000000-0000-0000-0000-000000000001',
    'c0000000-0000-0000-0000-000000000002',
    'c0000000-0000-0000-0000-000000000003'
  );
ALTER TABLE public.companies           ENABLE TRIGGER companies_lock_compliance_exempt_trigger;
ALTER TABLE public.transport_companies ENABLE TRIGGER transport_companies_lock_compliance_exempt_trigger;

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
),
(
  '10000000-0000-0000-0000-000000000007',
  'f0000000-0000-0000-0000-000000000007',  -- transport manager auth user
  'manager',
  NULL,
  'c0000000-0000-0000-0000-000000000001',  -- transport company
  NULL,
  NULL
),
(
  '10000000-0000-0000-0000-000000000008',
  'f0000000-0000-0000-0000-000000000008',  -- reviewer auth user
  'document_reviewer',
  NULL,   -- tenant-less, like admin
  NULL,
  NULL,
  NULL
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

-- ─────────────────────────────────────────────────────────────
-- CP2: COMPLIANCE DOCUMENTS
-- documents_before_insert/update (021) force server-trust fields based on
-- auth.uid(), which is NULL in this raw superuser seed session — so the
-- triggers are disabled for this block only and re-enabled immediately
-- after, letting us seed rows already in their final reviewed state.
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.documents DISABLE TRIGGER documents_before_insert_trigger;
ALTER TABLE public.documents DISABLE TRIGGER documents_before_update_trigger;

INSERT INTO public.documents (
  id, owner_type, owner_id, doc_type,
  file_path, file_sha256,
  issue_date, expiry_date,
  status, reviewed_by, reviewed_at, reject_reason,
  uploaded_by, created_at
)
VALUES
-- Company — fully verified (100% completion, ACTIVE)
(
  '11000000-0000-0000-0000-000000000001', 'company', 'a0000000-0000-0000-0000-000000000001',
  'commercial_registration', 'company/a0000000-0000-0000-0000-000000000001/commercial_registration-seed.pdf',
  encode(digest('seed-doc-1', 'sha256'), 'hex'),
  now() - interval '1 year', now() + interval '1 year',
  'verified', 'f0000000-0000-0000-0000-000000000008', now(), NULL,
  'f0000000-0000-0000-0000-000000000001', now() - interval '1 year'
),
(
  '11000000-0000-0000-0000-000000000002', 'company', 'a0000000-0000-0000-0000-000000000001',
  'vat_certificate', 'company/a0000000-0000-0000-0000-000000000001/vat_certificate-seed.pdf',
  encode(digest('seed-doc-2', 'sha256'), 'hex'),
  now() - interval '1 year', now() + interval '1 year',
  'verified', 'f0000000-0000-0000-0000-000000000008', now(), NULL,
  'f0000000-0000-0000-0000-000000000001', now() - interval '1 year'
),
-- Branch — fully verified
(
  '11000000-0000-0000-0000-000000000003', 'branch', 'b0000000-0000-0000-0000-000000000001',
  'municipal_license', 'branch/b0000000-0000-0000-0000-000000000001/municipal_license-seed.pdf',
  encode(digest('seed-doc-3', 'sha256'), 'hex'),
  now() - interval '1 year', now() + interval '1 year',
  'verified', 'f0000000-0000-0000-0000-000000000008', now(), NULL,
  'f0000000-0000-0000-0000-000000000001', now() - interval '1 year'
),
-- Transport company — fully verified
(
  '11000000-0000-0000-0000-000000000004', 'transport_company', 'c0000000-0000-0000-0000-000000000001',
  'commercial_registration', 'transport_company/c0000000-0000-0000-0000-000000000001/commercial_registration-seed.pdf',
  encode(digest('seed-doc-4', 'sha256'), 'hex'),
  now() - interval '1 year', now() + interval '1 year',
  'verified', 'f0000000-0000-0000-0000-000000000008', now(), NULL,
  'f0000000-0000-0000-0000-000000000007', now() - interval '1 year'
),
(
  '11000000-0000-0000-0000-000000000005', 'transport_company', 'c0000000-0000-0000-0000-000000000001',
  'ncwm_license', 'transport_company/c0000000-0000-0000-0000-000000000001/ncwm_license-seed.pdf',
  encode(digest('seed-doc-5', 'sha256'), 'hex'),
  now() - interval '1 year', now() + interval '1 year',
  'verified', 'f0000000-0000-0000-0000-000000000008', now(), NULL,
  'f0000000-0000-0000-0000-000000000007', now() - interval '1 year'
),
-- Driver — iqama verified; driving licence verified but expiring in ~10
-- days (demonstrates the 30/15/7-day expiry warning; still counts as
-- satisfied/ACTIVE since it is not yet expired).
(
  '11000000-0000-0000-0000-000000000006', 'driver', 'd0000000-0000-0000-0000-000000000001',
  'iqama', 'driver/d0000000-0000-0000-0000-000000000001/iqama-seed.pdf',
  encode(digest('seed-doc-6', 'sha256'), 'hex'),
  now() - interval '1 year', now() + interval '1 year',
  'verified', 'f0000000-0000-0000-0000-000000000008', now(), NULL,
  'f0000000-0000-0000-0000-000000000002', now() - interval '1 year'
),
(
  '11000000-0000-0000-0000-000000000007', 'driver', 'd0000000-0000-0000-0000-000000000001',
  'driving_license', 'driver/d0000000-0000-0000-0000-000000000001/driving_license-seed.pdf',
  encode(digest('seed-doc-7', 'sha256'), 'hex'),
  now() - interval '355 days', now() + interval '10 days',
  'verified', 'f0000000-0000-0000-0000-000000000008', now(), NULL,
  'f0000000-0000-0000-0000-000000000002', now() - interval '355 days'
),
-- Vehicle — registration verified; NCWM licence REJECTED (demonstrates the
-- restriction banner + "click here to resolve" flow).
(
  '11000000-0000-0000-0000-000000000008', 'vehicle', 'e0000000-0000-0000-0000-000000000001',
  'vehicle_registration', 'vehicle/e0000000-0000-0000-0000-000000000001/vehicle_registration-seed.pdf',
  encode(digest('seed-doc-8', 'sha256'), 'hex'),
  now() - interval '1 year', now() + interval '1 year',
  'verified', 'f0000000-0000-0000-0000-000000000008', now(), NULL,
  'f0000000-0000-0000-0000-000000000007', now() - interval '1 year'
),
(
  '11000000-0000-0000-0000-000000000009', 'vehicle', 'e0000000-0000-0000-0000-000000000001',
  'ncwm_license', 'vehicle/e0000000-0000-0000-0000-000000000001/ncwm_license-seed.pdf',
  encode(digest('seed-doc-9', 'sha256'), 'hex'),
  now() - interval '1 year', now() + interval '1 year',
  'rejected', 'f0000000-0000-0000-0000-000000000008', now(), 'الصورة غير واضحة، يرجى رفع نسخة أوضح / Scan is illegible, please re-upload a clear copy',
  'f0000000-0000-0000-0000-000000000007', now() - interval '5 days'
),
-- Facility — fully verified
(
  '1100000a-0000-0000-0000-000000000001', 'facility', '90000000-0000-0000-0000-000000000001',
  'commercial_registration', 'facility/90000000-0000-0000-0000-000000000001/commercial_registration-seed.pdf',
  encode(digest('seed-doc-10', 'sha256'), 'hex'),
  now() - interval '1 year', now() + interval '1 year',
  'verified', 'f0000000-0000-0000-0000-000000000008', now(), NULL,
  'f0000000-0000-0000-0000-000000000005', now() - interval '1 year'
),
(
  '1100000a-0000-0000-0000-000000000002', 'facility', '90000000-0000-0000-0000-000000000001',
  'operating_license', 'facility/90000000-0000-0000-0000-000000000001/operating_license-seed.pdf',
  encode(digest('seed-doc-11', 'sha256'), 'hex'),
  now() - interval '1 year', now() + interval '1 year',
  'verified', 'f0000000-0000-0000-0000-000000000008', now(), NULL,
  'f0000000-0000-0000-0000-000000000005', now() - interval '1 year'
)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.documents ENABLE TRIGGER documents_before_insert_trigger;
ALTER TABLE public.documents ENABLE TRIGGER documents_before_update_trigger;

END $$;
