-- ═══════════════════════════════════════════════════════════════════════════
-- Sanad 360 – Migration 009: Transporter read access to linked client scope
-- ═══════════════════════════════════════════════════════════════════════════
-- Drivers and other transport-company members act on pickup_assignments that
-- reference a client company's branch, but the 001 SELECT policies on
-- branches/companies are company-member-only. A signed-in driver therefore
-- could not read the branch name/address of their own assignment (the old
-- driverStore getBranch() call failed RLS for every real driver).
--
-- These are the read-side mirrors of 004/005's link-gated drivers/vehicles
-- policies: a transport member may read the companies (identity fields) and
-- branches (pickup locations) of client companies they are ACTIVELY linked to
-- via company_transporters — and nothing else. Additive, OR-combined with the
-- existing policies; write access is unchanged.
-- ═══════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS branches_select_for_linked_transporter ON public.branches;
CREATE POLICY branches_select_for_linked_transporter
  ON public.branches
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.company_transporters ct
      WHERE ct.status = 'active'
        AND ct.transport_company_id = (public.my_membership()).transport_company_id
        AND ct.company_id = branches.company_id
    )
  );

DROP POLICY IF EXISTS companies_select_for_linked_transporter ON public.companies;
CREATE POLICY companies_select_for_linked_transporter
  ON public.companies
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.company_transporters ct
      WHERE ct.status = 'active'
        AND ct.transport_company_id = (public.my_membership()).transport_company_id
        AND ct.company_id = companies.id
    )
  );

-- ═══════════════════════════════════════════════════════════════════════════
-- END OF MIGRATION 009
-- ═══════════════════════════════════════════════════════════════════════════
