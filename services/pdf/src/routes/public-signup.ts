import type { Request, Response } from 'express';
import { randomBytes, createHash } from 'node:crypto';
import { admin } from '../lib/supabase.js';
import { send } from '../lib/email.js';

interface SignupBody {
  tenant_type?: 'company' | 'transport_company';
  name_ar?: string;
  name_en?: string;
  commercial_registration?: string;
  vat_number?: string;
  industry_code?: string;
  contact_email?: string;
  contact_phone?: string;
  password?: string;
  locale?: 'ar' | 'en';
}

const CR_RE = /^\d{10}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^\+?[0-9]{7,15}$/;

// Same shape for a genuine success and any existence conflict (email or CR
// already taken) — no enumeration oracle. Only format/required-field
// problems (which reveal nothing about what already exists) get specific
// messages.
const AMBIGUOUS_RESPONSE = {
  message:
    'If this information is new to us, you will receive a verification email shortly.',
};

/**
 * POST /public/signup
 *
 * Unauthenticated, info-only (no file upload — documents are collected
 * later, during the pending_documents stage, via the existing authenticated
 * upload path). Creates: an inert auth user (email_confirm=false), a
 * profile, a pending_applications row (status='pending_email_verification',
 * only the sha256 of a fresh 256-bit token persisted), and an 'applicant'
 * membership. Sends the verification email; a failure there is logged but
 * does not fail the request (see verify-email's own comment for the same
 * posture applied to its side-effect).
 */
export async function handlePublicSignup(req: Request, res: Response): Promise<void> {
  const body = req.body as SignupBody;

  // ── 1. Format validation only — no DB touch, safe to be specific ────────
  if (body.tenant_type !== 'company' && body.tenant_type !== 'transport_company') {
    res.status(400).json({ error: 'tenant_type must be "company" or "transport_company"' });
    return;
  }
  if (!body.name_ar || !body.name_ar.trim()) {
    res.status(400).json({ error: 'name_ar is required' });
    return;
  }
  if (!body.commercial_registration || !CR_RE.test(body.commercial_registration.trim())) {
    res.status(400).json({ error: 'commercial_registration must be a 10-digit number' });
    return;
  }
  if (!body.contact_email || !EMAIL_RE.test(body.contact_email.trim())) {
    res.status(400).json({ error: 'contact_email must be a valid email address' });
    return;
  }
  if (body.contact_phone && !PHONE_RE.test(body.contact_phone.trim())) {
    res.status(400).json({ error: 'contact_phone is not a valid phone number' });
    return;
  }
  if (!body.password || body.password.length < 8) {
    res.status(400).json({ error: 'password must be at least 8 characters' });
    return;
  }
  if (body.tenant_type === 'company' && !body.industry_code) {
    res.status(400).json({ error: 'industry_code is required for company applications' });
    return;
  }
  if (body.tenant_type === 'transport_company' && body.industry_code) {
    res.status(400).json({ error: 'industry_code does not apply to transport_company applications' });
    return;
  }

  const commercialRegistration = body.commercial_registration.trim();
  const contactEmail = body.contact_email.trim().toLowerCase();
  const locale: 'ar' | 'en' = body.locale === 'en' ? 'en' : 'ar';

  // industry_code existence check — industries is public reference data,
  // not sensitive, so this can be specific without opening an oracle.
  if (body.tenant_type === 'company') {
    const { data: industry } = await admin
      .from('industries')
      .select('code')
      .eq('code', body.industry_code as string)
      .eq('is_active', true)
      .maybeSingle<{ code: string }>();
    if (!industry) {
      res.status(400).json({ error: 'industry_code is not a recognized, active industry' });
      return;
    }
  }

  // ── 2. Create the (inert) auth user ──────────────────────────────────────
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email: contactEmail,
    password: body.password,
    email_confirm: false,
  });

  if (createErr || !created.user) {
    const msg = (createErr?.message ?? '').toLowerCase();
    const code = (createErr as { code?: string } | null)?.code;
    if (code === 'email_exists' || msg.includes('already registered') || msg.includes('already exists')) {
      // Existence conflict — merge into the ambiguous path, no auth user
      // was created so there's nothing to roll back.
      res.status(202).json(AMBIGUOUS_RESPONSE);
      return;
    }
    console.error('[public-signup] auth.createUser failed:', createErr?.message ?? 'no user returned');
    res.status(500).json({ error: 'Signup failed. Please try again.' });
    return;
  }
  const userId = created.user.id;

  // ── 3. Upsert profile ─────────────────────────────────────────────────────
  const { error: profileErr } = await admin
    .from('profiles')
    .upsert({ id: userId, name_ar: body.name_ar.trim(), phone: body.contact_phone?.trim() ?? null }, { onConflict: 'id' });
  if (profileErr) {
    console.error('[public-signup] profiles.upsert failed:', profileErr.message);
    await admin.auth.admin.deleteUser(userId).catch((e) =>
      console.error('[public-signup] rollback deleteUser failed:', e instanceof Error ? e.message : String(e))
    );
    res.status(500).json({ error: 'Signup failed. Please try again.' });
    return;
  }

  // ── 4. Token: crypto-random 256 bits, only its sha256 persisted ──────────
  const rawToken = randomBytes(32).toString('hex');
  const tokenHash = createHash('sha256').update(rawToken).digest('hex');
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  // ── 5. Insert pending_applications ────────────────────────────────────────
  const { data: application, error: appErr } = await admin
    .from('pending_applications')
    .insert({
      applicant_user_id: userId,
      tenant_type: body.tenant_type,
      name_ar: body.name_ar.trim(),
      name_en: body.name_en?.trim() || null,
      commercial_registration: commercialRegistration,
      vat_number: body.vat_number?.trim() || null,
      industry_code: body.tenant_type === 'company' ? body.industry_code : null,
      contact_email: contactEmail,
      contact_phone: body.contact_phone?.trim() || null,
      email_verification_token_hash: tokenHash,
      email_verification_expires_at: expiresAt,
    })
    .select('id')
    .single<{ id: string }>();

  if (appErr || !application) {
    // 23505 = CR already active (or already a real tenant) — this is the
    // one place the CR-uniqueness oracle could leak, so it's the one place
    // that gets scrubbed into the ambiguous response. Any other insert
    // failure is a genuine server error.
    await admin.auth.admin.deleteUser(userId).catch((e) =>
      console.error('[public-signup] rollback deleteUser failed:', e instanceof Error ? e.message : String(e))
    );
    if (appErr?.code === '23505') {
      res.status(202).json(AMBIGUOUS_RESPONSE);
      return;
    }
    console.error('[public-signup] pending_applications.insert failed:', appErr?.message ?? 'no row returned');
    res.status(500).json({ error: 'Signup failed. Please try again.' });
    return;
  }

  // ── 6. Insert the tenant-less 'applicant' membership ──────────────────────
  const { error: memErr } = await admin.from('memberships').insert({ user_id: userId, role: 'applicant' });
  if (memErr) {
    console.error('[public-signup] memberships.insert failed:', memErr.message);
    res.status(500).json({ error: 'Signup failed. Please try again.' });
    return;
  }

  // ── 7. Send the verification email (best-effort — does not roll back) ────
  const appUrl = process.env.PUBLIC_APP_URL ?? 'http://localhost:5173';
  const link = `${appUrl}/verify?token=${rawToken}`;
  try {
    await send(contactEmail, 'verify', locale, { name: body.name_ar.trim(), link });
  } catch (e) {
    console.error(
      '[public-signup] verification email send failed:',
      e instanceof Error ? e.message : String(e),
      { applicationId: application.id }
    );
  }

  res.status(202).json(AMBIGUOUS_RESPONSE);
}
