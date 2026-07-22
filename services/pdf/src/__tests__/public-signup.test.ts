import { describe, it, expect, vi, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import { admin } from '../lib/supabase.js';
import { createReq, createRes, uniqueCr, uniqueEmail } from './helpers.js';

const sendMock = vi.fn().mockResolvedValue(undefined);
vi.mock('../lib/email.js', () => ({
  send: (...args: unknown[]) => sendMock(...args),
}));

const { handlePublicSignup } = await import('../routes/public-signup.js');

const createdUserIds: string[] = [];

afterEach(async () => {
  sendMock.mockClear();
  for (const id of createdUserIds.splice(0)) {
    await admin.from('pending_applications').delete().eq('applicant_user_id', id);
    await admin.from('memberships').delete().eq('user_id', id);
    await admin.auth.admin.deleteUser(id).catch(() => {});
  }
});

function validCompanyBody(overrides: Record<string, unknown> = {}) {
  return {
    tenant_type: 'company',
    name_ar: 'شركة تجريبية',
    commercial_registration: uniqueCr(),
    industry_code: 'healthcare',
    contact_email: uniqueEmail(),
    contact_phone: '+966501234567',
    password: 'correct-horse-battery',
    ...overrides,
  };
}

async function findUserIdByEmail(email: string): Promise<string | null> {
  // admin.auth.admin has no getUserByEmail in this SDK version; list + filter.
  const { data } = await admin.auth.admin.listUsers({ perPage: 200 });
  const user = data.users.find((u) => u.email === email);
  return user?.id ?? null;
}

describe('POST /public/signup', () => {
  it('creates an inert applicant + pending_application on valid company signup', async () => {
    const body = validCompanyBody();
    const req = createReq({ body });
    const res = createRes();

    await handlePublicSignup(req, res);

    expect(res.statusCode).toBe(202);
    expect(res.body).toEqual({
      message: 'If this information is new to us, you will receive a verification email shortly.',
    });

    const userId = await findUserIdByEmail(body.contact_email);
    expect(userId).toBeTruthy();
    createdUserIds.push(userId as string);

    const { data: authUser } = await admin.auth.admin.getUserById(userId as string);
    expect(authUser.user?.email_confirmed_at).toBeFalsy();

    const { data: app } = await admin
      .from('pending_applications')
      .select('*')
      .eq('applicant_user_id', userId as string)
      .single();
    expect(app.status).toBe('pending_email_verification');
    expect(app.commercial_registration).toBe(body.commercial_registration);
    expect(app.email_verification_token_hash).toBeTruthy();
    expect(app.email_verification_expires_at).toBeTruthy();

    const { data: memberships } = await admin
      .from('memberships')
      .select('role, company_id, transport_company_id, facility_id')
      .eq('user_id', userId as string);
    expect(memberships).toHaveLength(1);
    expect(memberships?.[0].role).toBe('applicant');
    expect(memberships?.[0].company_id).toBeNull();
    expect(memberships?.[0].transport_company_id).toBeNull();
    expect(memberships?.[0].facility_id).toBeNull();

    // Verification email was sent with only name + link — the raw token
    // rides in the link, and only its sha256 is what's persisted.
    expect(sendMock).toHaveBeenCalledTimes(1);
    const [, template, , vars] = sendMock.mock.calls[0];
    expect(template).toBe('verify');
    const link: string = vars.link;
    const token = new URL(link).searchParams.get('token');
    expect(token).toBeTruthy();
    const hash = createHash('sha256').update(token as string).digest('hex');
    expect(app.email_verification_token_hash).toBe(hash);
  });

  it('rejects a malformed commercial_registration with a specific 400', async () => {
    const req = createReq({ body: validCompanyBody({ commercial_registration: '123' }) });
    const res = createRes();
    await handlePublicSignup(req, res);
    expect(res.statusCode).toBe(400);
    expect((res.body as { error: string }).error).toMatch(/commercial_registration/);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('rejects a missing industry_code for a company application', async () => {
    const req = createReq({ body: validCompanyBody({ industry_code: undefined }) });
    const res = createRes();
    await handlePublicSignup(req, res);
    expect(res.statusCode).toBe(400);
    expect((res.body as { error: string }).error).toMatch(/industry_code/);
  });

  it('rejects an unrecognized industry_code', async () => {
    const req = createReq({ body: validCompanyBody({ industry_code: 'not-a-real-code' }) });
    const res = createRes();
    await handlePublicSignup(req, res);
    expect(res.statusCode).toBe(400);
  });

  it('gives the identical ambiguous response for a duplicate email (no oracle)', async () => {
    const body = validCompanyBody();
    await handlePublicSignup(createReq({ body }), createRes());
    const userId = await findUserIdByEmail(body.contact_email);
    createdUserIds.push(userId as string);

    const res2 = createRes();
    await handlePublicSignup(
      createReq({ body: validCompanyBody({ contact_email: body.contact_email }) }),
      res2
    );
    expect(res2.statusCode).toBe(202);
    expect(res2.body).toEqual({
      message: 'If this information is new to us, you will receive a verification email shortly.',
    });

    // No second pending_applications row was created for this email.
    const { data: apps } = await admin
      .from('pending_applications')
      .select('id')
      .eq('contact_email', body.contact_email);
    expect(apps).toHaveLength(1);
  });

  it('gives the identical ambiguous response for a duplicate active CR, and rolls back the new auth user', async () => {
    const body = validCompanyBody();
    await handlePublicSignup(createReq({ body }), createRes());
    const firstUserId = await findUserIdByEmail(body.contact_email);
    createdUserIds.push(firstUserId as string);

    const secondEmail = uniqueEmail();
    const res2 = createRes();
    await handlePublicSignup(
      createReq({ body: validCompanyBody({ commercial_registration: body.commercial_registration, contact_email: secondEmail }) }),
      res2
    );
    expect(res2.statusCode).toBe(202);
    expect(res2.body).toEqual({
      message: 'If this information is new to us, you will receive a verification email shortly.',
    });

    // The second attempt's auth user must have been rolled back (deleted) —
    // it never got a pending_application, so it must not be left inert.
    const secondUserId = await findUserIdByEmail(secondEmail);
    expect(secondUserId).toBeNull();

    const { data: apps } = await admin
      .from('pending_applications')
      .select('id')
      .eq('commercial_registration', body.commercial_registration);
    expect(apps).toHaveLength(1);
  });
});
