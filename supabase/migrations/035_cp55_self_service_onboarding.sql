-- ═══════════════════════════════════════════════════════════════════════════
-- Sanad 360 – Migration 035: CP5.5 self-service onboarding
-- ═══════════════════════════════════════════════════════════════════════════
-- Public signup -> email verification -> pending application -> reviewer
-- approval/rejection -> active tenant.
--
-- CORE INVARIANT (do not weaken): self-signup creates a PENDING APPLICATION,
-- never an active tenant. Nothing in this migration lets an applicant
-- self-activate. The ONLY path from pending_review to approved is
-- review_pending_application() below, which requires a real
-- document_reviewer/system_admin/admin/super_admin caller who is NOT the
-- applicant.
--
-- ARCHITECTURE: a pending application does not touch companies/
-- transport_companies at all until approved — it lives entirely in the new
-- pending_applications table below. The applicant's membership row uses the
-- new 'applicant' role (034) with company_id/transport_company_id/
-- facility_id all NULL. Every existing operational RLS policy in this
-- schema (pickup_events, branches, trips, disposal_confirmations,
-- pickup_confirmations, companies, memberships, ...) scopes access by
-- (my_membership()).company_id / .transport_company_id / an explicit role
-- allowlist — none of them mention 'applicant' or match a NULL tenant. This
-- is what gives an applicant zero access to any operational table with ZERO
-- changes to any existing policy in this migration.
--
-- Document uploads during the pending phase reuse the existing documents/
-- required_documents infrastructure with a new owner_type value
-- ('pending_application', owner_id = pending_applications.id) — so CP2's
-- existing per-document verify/reject flow (documents_before_update
-- trigger, can_review_documents()) runs completely unchanged underneath. On
-- approval, those SAME rows are re-parented (UPDATE owner_type/owner_id) onto
-- the new real tenant — not re-uploaded, not re-reviewed — preserving
-- reviewed_by/reviewed_at/status history exactly as CP2 already established.
--
-- DEFERRED (explicitly out of scope for this migration): the public signup
-- Express endpoint (services/pdf), the landing-page form, the review-queue
-- UI, and email sending/templates. Also deferred: the RLS test file proving
-- everything below — comes after this schema is approved, not blind against
-- unapplied SQL.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────
-- A. is_system_admin() — same shape as 025's is_full_admin() etc. Needed
--    because review_pending_application() below must recognize system_admin
--    as a valid reviewer, and no such helper existed yet (025 explicitly
--    deferred "system_admin's actual permission surface — pending product
--    decision"; this is the first place it's actually wired to anything).
--    Internal helper only, like every other function in this family — no
--    GRANT EXECUTE needed (none of is_full_admin/is_branch_operator_for/
--    can_manage_billing/is_gov_viewer have one either; PUBLIC's default
--    EXECUTE privilege is what every RLS policy/other function relies on).
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.is_system_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT (public.my_membership()).role = 'system_admin';
$$;

-- ─────────────────────────────────────────────────────────────
-- B. one_tenant — add 'applicant' to the tenant-less bucket (same DROP+ADD
--    pattern 025 used to widen this same constraint for the Maya-side
--    roles). Without this, a membership row with role='applicant' and every
--    tenant column NULL would violate the constraint at INSERT time.
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.memberships DROP CONSTRAINT one_tenant;
ALTER TABLE public.memberships ADD CONSTRAINT one_tenant CHECK (
  num_nonnulls(company_id, transport_company_id, facility_id) = 1
  OR (
    role IN (
      'admin', 'document_reviewer',
      'super_admin', 'system_admin', 'support_agent', 'billing_accountant',
      'gov_viewer', 'applicant'
    )
    AND company_id IS NULL AND transport_company_id IS NULL AND facility_id IS NULL
  )
);

-- ─────────────────────────────────────────────────────────────
-- C. pending_applications — the entire pending-phase record.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE public.pending_applications (
  id                              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  applicant_user_id               uuid        NOT NULL REFERENCES public.profiles(id),
  tenant_type                     text        NOT NULL CHECK (tenant_type IN ('company', 'transport_company')),

  name_ar                         text        NOT NULL,
  name_en                         text,
  commercial_registration         text        NOT NULL,
  vat_number                      text,
  -- Only meaningful for tenant_type='company' (transport_companies has no
  -- industry_code column either — waste-generating companies are the ones
  -- classified by industry, not transporters). Nullable for the same reason
  -- companies.industry_code itself is nullable (025): a real value may not
  -- exist yet; the app layer makes it required going forward for company
  -- applications specifically.
  industry_code                   text        REFERENCES public.industries(code),
  contact_email                   text        NOT NULL,
  contact_phone                   text,

  status                          text        NOT NULL DEFAULT 'pending_email_verification'
                                              CHECK (status IN (
                                                'pending_email_verification',
                                                'pending_review',
                                                'approved',
                                                'rejected'
                                              )),

  -- Custom email-verification token — deliberately independent of Supabase
  -- Auth's own email_confirmed_at (item 5 wants our own bilingual SES
  -- templates, not Supabase's default delivery). Never store the raw
  -- token — only its sha256 hash, cleared once consumed. The endpoint
  -- (deferred) is responsible for ALSO calling
  -- admin.auth.admin.updateUserById(id, {email_confirm:true}) once
  -- verify_application_email() below succeeds, so the applicant can
  -- actually log in.
  email_verification_token_hash   text,
  email_verification_expires_at   timestamptz,
  email_verified_at               timestamptz,

  reviewed_by                     uuid        REFERENCES public.profiles(id),
  reviewed_at                     timestamptz,
  reject_reason                   text,

  -- Set only on approval — lets an approved application trace to the real
  -- tenant it became, without companies/transport_companies needing to know
  -- anything about self-signup at all.
  resulting_company_id            uuid        REFERENCES public.companies(id),
  resulting_transport_company_id  uuid        REFERENCES public.transport_companies(id),

  created_at                      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT pending_applications_industry_code_scope CHECK (
    tenant_type = 'company' OR industry_code IS NULL
  ),
  CONSTRAINT pending_applications_reject_reason_required CHECK (
    status <> 'rejected' OR (reject_reason IS NOT NULL AND btrim(reject_reason) <> '')
  ),
  CONSTRAINT pending_applications_reviewed_fields_consistency CHECK (
    (status IN ('approved', 'rejected') AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)
    OR
    (status IN ('pending_email_verification', 'pending_review') AND reviewed_by IS NULL AND reviewed_at IS NULL)
  ),
  CONSTRAINT pending_applications_email_verification_consistency CHECK (
    status <> 'pending_email_verification' OR email_verified_at IS NULL
  ),
  CONSTRAINT pending_applications_resulting_tenant_consistency CHECK (
    (status = 'approved' AND tenant_type = 'company'
      AND resulting_company_id IS NOT NULL AND resulting_transport_company_id IS NULL)
    OR
    (status = 'approved' AND tenant_type = 'transport_company'
      AND resulting_transport_company_id IS NOT NULL AND resulting_company_id IS NULL)
    OR
    (status <> 'approved' AND resulting_company_id IS NULL AND resulting_transport_company_id IS NULL)
  )
);

CREATE INDEX pending_applications_status_idx ON public.pending_applications (status);
CREATE INDEX pending_applications_applicant_idx ON public.pending_applications (applicant_user_id);

-- CR dedupe, part 1: only one non-rejected application per CR at a time. A
-- rejected application does not block resubmission (a fixed/corrected
-- re-application for the same real company must be possible).
CREATE UNIQUE INDEX pending_applications_cr_active_uq
  ON public.pending_applications (commercial_registration)
  WHERE status <> 'rejected';

-- CR dedupe, part 2: cannot apply for a CR that's already a real, approved
-- tenant. A BEFORE INSERT trigger (not just an app-layer check) so this
-- invariant holds regardless of caller — matches this schema's general
-- preference for DB-enforced invariants over app-layer-only checks.
CREATE OR REPLACE FUNCTION public.pending_applications_check_cr_available()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.companies WHERE commercial_registration = NEW.commercial_registration)
     OR EXISTS (SELECT 1 FROM public.transport_companies WHERE commercial_registration = NEW.commercial_registration)
  THEN
    RAISE EXCEPTION 'A company with this commercial registration is already registered.'
      USING ERRCODE = '23505';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER pending_applications_check_cr_trigger
  BEFORE INSERT ON public.pending_applications
  FOR EACH ROW EXECUTE FUNCTION public.pending_applications_check_cr_available();

ALTER TABLE public.pending_applications ENABLE ROW LEVEL SECURITY;

-- Applicant sees only their own application. Reviewers see every
-- pending_review application (the review queue). No SELECT path exists for
-- anon — the applicant must be logged in (post email-verification) to check
-- status; the reviewer must be authenticated with a real reviewer role.
CREATE POLICY pending_applications_select_own ON public.pending_applications
  FOR SELECT TO authenticated
  USING (applicant_user_id = auth.uid());

CREATE POLICY pending_applications_select_reviewer ON public.pending_applications
  FOR SELECT TO authenticated
  USING (
    public.can_review_documents() OR public.is_system_admin() OR public.is_full_admin()
  );

-- No authenticated/anon INSERT, UPDATE, or DELETE policy at all. The only
-- write paths are: (1) the signup endpoint's service_role client (bypasses
-- RLS entirely, same posture as onboard.ts's admin onboarding flow), and
-- (2) the two SECURITY DEFINER functions below, which bypass RLS
-- internally and are their OWN authorization gate — same posture as
-- gov_rollup(). Column-level SELECT grant excludes the verification token
-- hash/expiry (defense in depth, mirroring branches.qr_token's column
-- lockdown — the hash alone isn't practically exploitable, but a raw
-- secret-shaped column should never be client-visible on principle).
GRANT SELECT (
  id, applicant_user_id, tenant_type, name_ar, name_en, commercial_registration,
  vat_number, industry_code, contact_email, contact_phone, status,
  email_verified_at, reviewed_by, reviewed_at, reject_reason,
  resulting_company_id, resulting_transport_company_id, created_at
) ON public.pending_applications TO authenticated;
GRANT ALL ON public.pending_applications TO service_role;

-- ─────────────────────────────────────────────────────────────
-- D. Extend documents/required_documents to accept 'pending_application' as
--    an owner_type — the SAME CP2 doc-review pipeline, one more owner kind.
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.required_documents DROP CONSTRAINT required_documents_owner_type_check;
ALTER TABLE public.required_documents ADD CONSTRAINT required_documents_owner_type_check
  CHECK (owner_type IN ('company', 'branch', 'transport_company', 'driver', 'vehicle', 'facility', 'pending_application'));

ALTER TABLE public.documents DROP CONSTRAINT documents_owner_type_check;
ALTER TABLE public.documents ADD CONSTRAINT documents_owner_type_check
  CHECK (owner_type IN ('company', 'branch', 'transport_company', 'driver', 'vehicle', 'facility', 'pending_application'));

-- owns_document_target(): lets an applicant upload documents against their
-- OWN pending application (documents_insert already requires
-- uploaded_by = auth.uid() on top of this).
CREATE OR REPLACE FUNCTION public.owns_document_target(p_owner_type text, p_owner_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  m public.memberships;
BEGIN
  m := public.my_membership();
  IF m.role = 'admin' THEN
    RETURN true;
  END IF;

  CASE p_owner_type
    WHEN 'company' THEN
      RETURN m.role IN ('owner','manager') AND m.company_id = p_owner_id;
    WHEN 'branch' THEN
      RETURN m.role IN ('owner','manager') AND EXISTS (
        SELECT 1 FROM public.branches b WHERE b.id = p_owner_id AND b.company_id = m.company_id
      );
    WHEN 'transport_company' THEN
      RETURN m.role IN ('owner','manager') AND m.transport_company_id = p_owner_id;
    WHEN 'vehicle' THEN
      RETURN m.role IN ('owner','manager') AND EXISTS (
        SELECT 1 FROM public.vehicles v WHERE v.id = p_owner_id AND v.transport_company_id = m.transport_company_id
      );
    WHEN 'driver' THEN
      RETURN (
        m.role IN ('owner','manager','dispatcher') AND EXISTS (
          SELECT 1 FROM public.drivers d WHERE d.id = p_owner_id AND d.transport_company_id = m.transport_company_id
        )
      );
    WHEN 'pending_application' THEN
      RETURN m.role = 'applicant' AND EXISTS (
        SELECT 1 FROM public.pending_applications pa
        WHERE pa.id = p_owner_id AND pa.applicant_user_id = auth.uid()
      );
    ELSE
      RETURN false;
  END CASE;
END;
$$;

-- can_view_document_target(): same idea for SELECT (documents_select is
-- `can_review_documents() OR can_view_document_target(...)` — reviewers
-- already see every owner_type via the first clause, this only adds the
-- applicant's own view of their own uploads).
CREATE OR REPLACE FUNCTION public.can_view_document_target(p_owner_type text, p_owner_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  m public.memberships;
BEGIN
  m := public.my_membership();
  CASE p_owner_type
    WHEN 'company' THEN
      RETURN m.company_id = p_owner_id;
    WHEN 'branch' THEN
      RETURN EXISTS (SELECT 1 FROM public.branches b WHERE b.id = p_owner_id AND b.company_id = m.company_id);
    WHEN 'transport_company' THEN
      RETURN m.transport_company_id = p_owner_id;
    WHEN 'vehicle' THEN
      RETURN EXISTS (SELECT 1 FROM public.vehicles v WHERE v.id = p_owner_id AND v.transport_company_id = m.transport_company_id);
    WHEN 'driver' THEN
      RETURN EXISTS (
        SELECT 1 FROM public.drivers d
        WHERE d.id = p_owner_id AND (d.transport_company_id = m.transport_company_id OR d.profile_id = auth.uid())
      );
    WHEN 'facility' THEN
      RETURN m.facility_id = p_owner_id;
    WHEN 'pending_application' THEN
      RETURN m.role = 'applicant' AND EXISTS (
        SELECT 1 FROM public.pending_applications pa
        WHERE pa.id = p_owner_id AND pa.applicant_user_id = auth.uid()
      );
    ELSE
      RETURN false;
  END CASE;
END;
$$;

-- storage_document_prefix_allowed(): same extension for the storage-path
-- gate (uploads go to a bucket path keyed by owner_type/owner_id).
CREATE OR REPLACE FUNCTION public.storage_document_prefix_allowed(p_owner_type text, p_owner_id_text text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  m public.memberships;
BEGIN
  m := public.my_membership();
  IF m.role = 'admin' OR m.role = 'document_reviewer' THEN
    RETURN true;
  END IF;

  CASE p_owner_type
    WHEN 'company' THEN
      RETURN m.company_id::text = p_owner_id_text;
    WHEN 'branch' THEN
      RETURN EXISTS (SELECT 1 FROM public.branches b WHERE b.id::text = p_owner_id_text AND b.company_id = m.company_id);
    WHEN 'transport_company' THEN
      RETURN m.transport_company_id::text = p_owner_id_text;
    WHEN 'vehicle' THEN
      RETURN EXISTS (SELECT 1 FROM public.vehicles v WHERE v.id::text = p_owner_id_text AND v.transport_company_id = m.transport_company_id);
    WHEN 'driver' THEN
      RETURN EXISTS (
        SELECT 1 FROM public.drivers d
        WHERE d.id::text = p_owner_id_text AND (d.transport_company_id = m.transport_company_id OR d.profile_id = auth.uid())
      );
    WHEN 'facility' THEN
      RETURN m.facility_id::text = p_owner_id_text;
    WHEN 'pending_application' THEN
      RETURN m.role = 'applicant' AND EXISTS (
        SELECT 1 FROM public.pending_applications pa
        WHERE pa.id::text = p_owner_id_text AND pa.applicant_user_id = auth.uid()
      );
    ELSE
      RETURN false;
  END CASE;
END;
$$;

-- ─────────────────────────────────────────────────────────────
-- E. verify_application_email(token) — anon-callable. The only thing an
--    unauthenticated caller can ever do to this table. Hashes the incoming
--    raw token (never trust/accept a pre-hashed value from the client) and
--    matches it against the stored hash; generic failure (no row found /
--    expired) so this can't be used to enumerate applications or leak
--    whether a given token almost-matched.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.verify_application_email(p_token text)
RETURNS TABLE (success boolean, application_id uuid, applicant_user_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_hash text;
  v_app public.pending_applications;
BEGIN
  IF p_token IS NULL OR btrim(p_token) = '' THEN
    RETURN QUERY SELECT false, NULL::uuid, NULL::uuid;
    RETURN;
  END IF;

  v_hash := encode(extensions.digest(convert_to(p_token, 'UTF8'), 'sha256'), 'hex');

  SELECT * INTO v_app
  FROM public.pending_applications
  WHERE email_verification_token_hash = v_hash
    AND status = 'pending_email_verification'
    AND email_verification_expires_at > now();

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, NULL::uuid, NULL::uuid;
    RETURN;
  END IF;

  UPDATE public.pending_applications
  SET status = 'pending_review',
      email_verified_at = now(),
      email_verification_token_hash = NULL,
      email_verification_expires_at = NULL
  WHERE id = v_app.id;

  RETURN QUERY SELECT true, v_app.id, v_app.applicant_user_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.verify_application_email(text) TO anon, authenticated;

-- ─────────────────────────────────────────────────────────────
-- F. review_pending_application(id, decision, reject_reason) — the ONLY
--    path from pending_review to approved/rejected. Does everything
--    atomically (single function call = single transaction):
--      - authorization: caller must be document_reviewer/system_admin/
--        admin/super_admin
--      - approver != applicant (hard requirement, checked explicitly —
--        never assume it "can't happen" just because reviewers are
--        Maya-side accounts)
--      - locks the row (FOR UPDATE) and requires status = 'pending_review'
--      - on reject: sets status/reviewed_by/reviewed_at/reject_reason,
--        soft-revokes the applicant's membership row
--      - on approve: creates the REAL companies/transport_companies row,
--        soft-revokes the applicant membership, inserts a fresh 'owner'
--        membership, re-parents any pending_application-owned documents
--        onto the new tenant, sets resulting_company_id/
--        resulting_transport_company_id
--      - writes exactly one audit_log row either way
--    Mirrors gov_rollup()'s posture: SECURITY DEFINER, bypasses RLS
--    internally, but the function body IS the authorization check — the
--    GRANT EXECUTE below is not a substitute for it.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.review_pending_application(
  p_application_id uuid,
  p_decision text,
  p_reject_reason text DEFAULT NULL
)
RETURNS TABLE (
  status                          text,
  resulting_company_id            uuid,
  resulting_transport_company_id  uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_reviewer_role public.member_role;
  v_app public.pending_applications;
  v_new_tenant_id uuid;
BEGIN
  v_reviewer_role := (public.my_membership()).role;
  IF v_reviewer_role NOT IN ('document_reviewer', 'system_admin', 'admin', 'super_admin') THEN
    RAISE EXCEPTION 'FORBIDDEN: only document_reviewer/system_admin/admin/super_admin may review applications'
      USING ERRCODE = '42501';
  END IF;

  IF p_decision NOT IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'invalid decision: must be ''approved'' or ''rejected''';
  END IF;

  SELECT * INTO v_app FROM public.pending_applications WHERE id = p_application_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'application not found';
  END IF;

  IF v_app.status <> 'pending_review' THEN
    RAISE EXCEPTION 'application is not awaiting review (current status: %)', v_app.status;
  END IF;

  -- Approver must differ from the applicant — defense in depth against the
  -- pathological case where a reviewer role is somehow granted to the
  -- applicant's own account.
  IF auth.uid() = v_app.applicant_user_id THEN
    RAISE EXCEPTION 'FORBIDDEN: a reviewer cannot approve or reject their own application'
      USING ERRCODE = '42501';
  END IF;

  IF p_decision = 'rejected' THEN
    IF p_reject_reason IS NULL OR btrim(p_reject_reason) = '' THEN
      RAISE EXCEPTION 'reject_reason is required when rejecting an application';
    END IF;

    UPDATE public.pending_applications
    SET status = 'rejected', reviewed_by = auth.uid(), reviewed_at = now(), reject_reason = p_reject_reason
    WHERE id = p_application_id;

    UPDATE public.memberships
    SET revoked_at = now(), revoked_by = auth.uid(),
        revoke_reason = 'Application rejected: ' || p_reject_reason
    WHERE user_id = v_app.applicant_user_id AND role = 'applicant' AND revoked_at IS NULL;

    INSERT INTO public.audit_log (user_id, tenant_id, tenant_type, action, entity_type, entity_id, changes)
    VALUES (
      auth.uid(), NULL, 'admin', 'reject_pending_application', 'pending_applications', p_application_id,
      jsonb_build_object('applicant_user_id', v_app.applicant_user_id, 'reject_reason', p_reject_reason)
    );

    RETURN QUERY SELECT 'rejected'::text, NULL::uuid, NULL::uuid;
    RETURN;
  END IF;

  -- decision = 'approved'
  IF v_app.tenant_type = 'company' THEN
    INSERT INTO public.companies (name_ar, name_en, commercial_registration, vat_number, industry_code)
    VALUES (v_app.name_ar, v_app.name_en, v_app.commercial_registration, v_app.vat_number, v_app.industry_code)
    RETURNING id INTO v_new_tenant_id;
  ELSE
    INSERT INTO public.transport_companies (name_ar, name_en, commercial_registration)
    VALUES (v_app.name_ar, v_app.name_en, v_app.commercial_registration)
    RETURNING id INTO v_new_tenant_id;
  END IF;

  UPDATE public.pending_applications
  SET status = 'approved', reviewed_by = auth.uid(), reviewed_at = now(),
      resulting_company_id = CASE WHEN v_app.tenant_type = 'company' THEN v_new_tenant_id END,
      resulting_transport_company_id = CASE WHEN v_app.tenant_type = 'transport_company' THEN v_new_tenant_id END
  WHERE id = p_application_id;

  UPDATE public.memberships
  SET revoked_at = now(), revoked_by = auth.uid(),
      revoke_reason = 'Application approved — promoted to owner membership'
  WHERE user_id = v_app.applicant_user_id AND role = 'applicant' AND revoked_at IS NULL;

  INSERT INTO public.memberships (user_id, role, company_id, transport_company_id)
  VALUES (
    v_app.applicant_user_id, 'owner',
    CASE WHEN v_app.tenant_type = 'company' THEN v_new_tenant_id END,
    CASE WHEN v_app.tenant_type = 'transport_company' THEN v_new_tenant_id END
  );

  -- Re-parent the SAME document rows (preserves reviewed_by/reviewed_at/
  -- status history) rather than requiring re-upload+re-review.
  UPDATE public.documents
  SET owner_type = v_app.tenant_type, owner_id = v_new_tenant_id
  WHERE owner_type = 'pending_application' AND owner_id = p_application_id;

  INSERT INTO public.audit_log (user_id, tenant_id, tenant_type, action, entity_type, entity_id, changes)
  VALUES (
    auth.uid(), v_new_tenant_id, v_app.tenant_type, 'approve_pending_application', 'pending_applications', p_application_id,
    jsonb_build_object(
      'applicant_user_id', v_app.applicant_user_id,
      'tenant_type', v_app.tenant_type,
      'resulting_tenant_id', v_new_tenant_id
    )
  );

  RETURN QUERY SELECT
    'approved'::text,
    CASE WHEN v_app.tenant_type = 'company' THEN v_new_tenant_id END,
    CASE WHEN v_app.tenant_type = 'transport_company' THEN v_new_tenant_id END;
END;
$$;

GRANT EXECUTE ON FUNCTION public.review_pending_application(uuid, text, text) TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- END OF MIGRATION 035
-- ═══════════════════════════════════════════════════════════════════════════
