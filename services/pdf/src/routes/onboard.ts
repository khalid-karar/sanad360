import type { Request, Response } from 'express';
import { admin, anon } from '../lib/supabase.js';

interface OnboardBody {
  tenant_type?: 'company' | 'transport_company';
  name_ar?: string;
  name_en?: string;
  commercial_registration?: string;
  vat_number?: string;
  owner_name_ar?: string;
  owner_email?: string;
  owner_temp_password?: string;
  /** Optional: transport companies to link to a newly created company. */
  transport_company_ids?: string[];
}

/**
 * POST /admin/onboard-company
 *
 * Auth model (deliberately NOT using the shared authMiddleware, which only
 * checks for *any* membership):
 *   1. Read the Bearer JWT.
 *   2. Validate it with the ANON client's auth.getUser(jwt) → caller user.id.
 *   3. Confirm an active 'admin' membership for that user via the service client.
 *   4. Only then perform the privileged onboarding with the service client.
 *
 * Any failure in 1-3 returns 403 { error: 'Forbidden' } (no information leak).
 */
export async function handleOnboardCompany(req: Request, res: Response): Promise<void> {
  // ── 1. Bearer token ────────────────────────────────────────────────────────
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }
  const jwt = authHeader.slice(7);

  // ── 2. Validate JWT with the anon client ───────────────────────────────────
  if (!anon) {
    res.status(500).json({ error: 'Server missing SUPABASE_ANON_KEY' });
    return;
  }
  const { data: userData, error: userErr } = await anon.auth.getUser(jwt);
  if (userErr || !userData.user) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }
  const callerId = userData.user.id;

  // ── 3. Confirm admin membership (service client) ────────────────────────────
  // NOTE: memberships has NO status column (see migration 004's comment); the
  // previous .eq('status','active') filter errored on the unknown column and
  // made this endpoint return 403 for every caller, including real admins.
  const { data: membership } = await admin
    .from('memberships')
    .select('role')
    .eq('user_id', callerId)
    .eq('role', 'admin')
    .maybeSingle<{ role: string }>();

  if (!membership) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }

  // ── 4. Validate the request body ────────────────────────────────────────────
  const body = req.body as OnboardBody;
  const tenantType = body.tenant_type;
  if (tenantType !== 'company' && tenantType !== 'transport_company') {
    res.status(400).json({ error: 'tenant_type must be "company" or "transport_company"' });
    return;
  }
  if (!body.name_ar || !body.commercial_registration || !body.owner_email || !body.owner_temp_password) {
    res.status(400).json({
      error: 'name_ar, commercial_registration, owner_email and owner_temp_password are required',
    });
    return;
  }

  try {
    // ── 4a. Create the owner auth user ──────────────────────────────────────
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email: body.owner_email,
      password: body.owner_temp_password,
      email_confirm: true,
      user_metadata: { name_ar: body.owner_name_ar ?? body.name_ar },
    });
    if (createErr || !created.user) {
      res.status(400).json({ error: `auth.createUser: ${createErr?.message ?? 'failed'}` });
      return;
    }
    const userId = created.user.id;

    // ── 4b. Upsert the profile (handle_new_user may already have inserted one) ─
    const { data: profile, error: profileErr } = await admin
      .from('profiles')
      .upsert({ id: userId, name_ar: body.owner_name_ar ?? body.name_ar }, { onConflict: 'id' })
      .select('id')
      .single<{ id: string }>();
    if (profileErr || !profile) {
      res.status(400).json({ error: `profiles.upsert: ${profileErr?.message ?? 'failed'}` });
      return;
    }

    // ── 4c. Insert the tenant (company OR transport_company) ─────────────────
    let companyId: string;
    if (tenantType === 'company') {
      const { data: company, error: companyErr } = await admin
        .from('companies')
        .insert({
          name_ar: body.name_ar,
          name_en: body.name_en ?? null,
          commercial_registration: body.commercial_registration,
          vat_number: body.vat_number ?? null,
        })
        .select('id')
        .single<{ id: string }>();
      if (companyErr || !company) {
        res.status(400).json({ error: `companies.insert: ${companyErr?.message ?? 'failed'}` });
        return;
      }
      companyId = company.id;
    } else {
      const { data: tc, error: tcErr } = await admin
        .from('transport_companies')
        .insert({
          name_ar: body.name_ar,
          name_en: body.name_en ?? null,
          commercial_registration: body.commercial_registration,
        })
        .select('id')
        .single<{ id: string }>();
      if (tcErr || !tc) {
        res.status(400).json({ error: `transport_companies.insert: ${tcErr?.message ?? 'failed'}` });
        return;
      }
      companyId = tc.id;
    }

    // ── 4d. Link the owner via a membership ──────────────────────────────────
    const membershipRow: {
      user_id: string;
      role: string;
      company_id?: string;
      transport_company_id?: string;
    } =
      tenantType === 'company'
        ? { user_id: userId, role: 'owner', company_id: companyId }
        : { user_id: userId, role: 'owner', transport_company_id: companyId };

    const { error: memErr } = await admin.from('memberships').insert(membershipRow);
    if (memErr) {
      res.status(400).json({ error: `memberships.insert: ${memErr.message}` });
      return;
    }

    // ── 4e. Optionally link transport companies (company tenants only) ───────
    // Best-effort: a bad ID logs a warning but never rolls back the company.
    const warnings: string[] = [];
    if (
      tenantType === 'company' &&
      Array.isArray(body.transport_company_ids) &&
      body.transport_company_ids.length > 0
    ) {
      for (const tcId of body.transport_company_ids) {
        const { error: linkErr } = await admin.from('company_transporters').insert({
          company_id: companyId,
          transport_company_id: tcId,
          status: 'active',
        });
        if (linkErr) {
          const msg = `company_transporters.insert (${tcId}): ${linkErr.message}`;
          console.error(msg);
          warnings.push(msg);
        }
      }
    }

    res.status(201).json({ companyId, userId, profileId: profile.id, warnings });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Onboarding failed' });
  }
}
