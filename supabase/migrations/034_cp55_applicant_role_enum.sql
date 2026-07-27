-- ═══════════════════════════════════════════════════════════════════════════
-- Sanad 360 – Migration 034: CP5.5 self-service onboarding — 'applicant' role
-- ═══════════════════════════════════════════════════════════════════════════
-- Isolated into its own migration, mirroring 024's precedent for every other
-- CP5 role value: Postgres restricts using a brand-new enum value in the
-- SAME transaction that added it (comparisons / CHECK-constraint validation
-- involving the new value can raise "unsafe use of new value of enum type").
-- 024 added 7 role values in isolation for exactly this reason, then 025
-- wired them into policies/constraints in the NEXT migration — same split
-- here: 035 (the next migration) is what actually references 'applicant' in
-- the one_tenant CHECK and in new RLS policies.
--
-- 'applicant' is the membership role held by a self-signup applicant for the
-- entire pending phase (pending_email_verification -> pending_review). It
-- carries NO company_id/transport_company_id/facility_id (added to the
-- tenant-less bucket of the one_tenant CHECK in 035) — which is what gives
-- an applicant automatic, zero-code-change access to NOTHING operational:
-- every existing RLS policy in this schema scopes by
-- (my_membership()).company_id / .transport_company_id / an explicit role
-- allowlist, and none of them mention 'applicant' or match a NULL tenant.
-- No retrofitting of any existing policy is required or done here.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TYPE public.member_role ADD VALUE 'applicant';

-- ═══════════════════════════════════════════════════════════════════════════
-- END OF MIGRATION 034
-- ═══════════════════════════════════════════════════════════════════════════
