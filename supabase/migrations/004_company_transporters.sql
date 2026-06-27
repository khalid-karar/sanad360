-- ═══════════════════════════════════════════════════════════════════════════
-- Tadweer360 – Migration 004: Company ↔ Transporter Links
-- ═══════════════════════════════════════════════════════════════════════════
-- Many-to-many: a company may use several transporters; a transporter serves
-- many companies. Replaces the scheduling hack that derived the transporter
-- from the most-recent pickup event.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE public.company_transporters (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id           uuid        NOT NULL REFERENCES public.companies(id),
  transport_company_id uuid        NOT NULL REFERENCES public.transport_companies(id),
  status               text        NOT NULL DEFAULT 'active'
                                   CHECK (status IN ('active','inactive')),
  created_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, transport_company_id)
);

CREATE INDEX company_transporters_company_idx   ON public.company_transporters(company_id);
CREATE INDEX company_transporters_tc_idx        ON public.company_transporters(transport_company_id);

ALTER TABLE public.company_transporters ENABLE ROW LEVEL SECURITY;

-- NOTE: public.memberships has NO `status` column in this schema (the 003
-- `status` column lives on branches/pickup_assignments). Existing RLS uses the
-- SECURITY DEFINER helper public.my_membership() which returns the caller's single
-- membership row. We mirror that convention here to stay consistent and avoid the
-- non-existent column.

-- SELECT: company member sees their links; transport company member sees links referencing them; admin sees all
CREATE POLICY company_transporters_select ON public.company_transporters
  FOR SELECT TO authenticated
  USING (
    (public.my_membership()).company_id = company_id
    OR (public.my_membership()).transport_company_id = transport_company_id
    OR (public.my_membership()).role = 'admin'
  );

-- INSERT: company owner/manager (or admin) can add links for their company
CREATE POLICY company_transporters_insert ON public.company_transporters
  FOR INSERT TO authenticated
  WITH CHECK (
    (
      (public.my_membership()).company_id = company_id
      AND (public.my_membership()).role IN ('owner','manager')
    )
    OR (public.my_membership()).role = 'admin'
  );

-- UPDATE: same as INSERT (to flip status active↔inactive)
CREATE POLICY company_transporters_update ON public.company_transporters
  FOR UPDATE TO authenticated
  USING (
    (
      (public.my_membership()).company_id = company_id
      AND (public.my_membership()).role IN ('owner','manager')
    )
    OR (public.my_membership()).role = 'admin'
  );

GRANT SELECT, INSERT, UPDATE ON public.company_transporters TO authenticated;
GRANT ALL ON public.company_transporters TO service_role;

-- ─────────────────────────────────────────────────────────────
-- transport_companies catalog visibility for COMPANY members
--
-- The 001 transport_companies_select policy only lets a member see the single
-- transport company their membership points at (or admins see all). But a
-- *company* manager/owner needs to browse the transporter catalog to pick which
-- ones to link (onboarding + Approved Transporters screen). The catalog holds
-- only non-sensitive identity fields (name, CR, NCWM license), so we add a
-- second, additive SELECT policy granting any company-scoped member read access
-- to the full list. RLS policies are OR-combined, so this widens — never
-- narrows — existing visibility.
-- ─────────────────────────────────────────────────────────────
CREATE POLICY transport_companies_select_for_company_members
  ON public.transport_companies
  FOR SELECT TO authenticated
  USING (
    (public.my_membership()).company_id IS NOT NULL
  );

-- ─────────────────────────────────────────────────────────────
-- drivers / vehicles visibility for COMPANY members of LINKED transporters
--
-- The 001 drivers/vehicles SELECT policies only let members of the OWNING
-- transport company (or admins) read them. But a *company* manager scheduling a
-- pickup must see the active drivers/vehicles of the transport companies they
-- have actively linked via company_transporters. These additive (OR-combined)
-- policies grant exactly that — read access scoped to the caller's company's
-- ACTIVE transporter links — and nothing more.
-- ─────────────────────────────────────────────────────────────
CREATE POLICY drivers_select_for_linked_company
  ON public.drivers
  FOR SELECT TO authenticated
  USING (
    transport_company_id IN (
      SELECT ct.transport_company_id
      FROM public.company_transporters ct
      WHERE ct.company_id = (public.my_membership()).company_id
        AND ct.status = 'active'
    )
  );

CREATE POLICY vehicles_select_for_linked_company
  ON public.vehicles
  FOR SELECT TO authenticated
  USING (
    transport_company_id IN (
      SELECT ct.transport_company_id
      FROM public.company_transporters ct
      WHERE ct.company_id = (public.my_membership()).company_id
        AND ct.status = 'active'
    )
  );
