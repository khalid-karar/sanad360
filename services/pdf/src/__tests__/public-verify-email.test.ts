import { describe, it, expect, vi, afterEach } from 'vitest';
import { admin } from '../lib/supabase.js';
import { createReq, createRes, uniqueCr, uniqueEmail } from './helpers.js';

const sendMock = vi.fn().mockResolvedValue(undefined);
vi.mock('../lib/email.js', () => ({
  send: (...args: unknown[]) => sendMock(...args),
}));

const { handlePublicSignup } = await import('../routes/public-signup.js');
const { handlePublicVerifyEmail } = await import('../routes/public-verify-email.js');

const createdUserIds: string[] = [];

afterEach(async () => {
  sendMock.mockClear();
  for (const id of createdUserIds.splice(0)) {
    await admin.from('pending_applications').delete().eq('applicant_user_id', id);
    await admin.from('memberships').delete().eq('user_id', id);
    await admin.auth.admin.deleteUser(id).catch(() => {});
  }
});

async function findUserIdByEmail(email: string): Promise<string> {
  const { data } = await admin.auth.admin.listUsers({ perPage: 200 });
  const user = data.users.find((u) => u.email === email);
  return user?.id as string;
}

async function signUpFixture(): Promise<{ userId: string; applicationId: string; token: string; email: string }> {
  const email = uniqueEmail();
  const body = {
    tenant_type: 'company' as const,
    name_ar: 'شركة تجريبية',
    commercial_registration: uniqueCr(),
    industry_code: 'healthcare',
    contact_email: email,
    password: 'correct-horse-battery',
  };
  await handlePublicSignup(createReq({ body }), createRes());
  const userId = await findUserIdByEmail(email);
  createdUserIds.push(userId);
  const [, , , vars] = sendMock.mock.calls[sendMock.mock.calls.length - 1];
  const token = new URL((vars as { link: string }).link).searchParams.get('token') as string;
  const { data: app } = await admin
    .from('pending_applications')
    .select('id')
    .eq('applicant_user_id', userId)
    .single();
  return { userId, applicationId: app.id, token, email };
}

describe('POST /public/verify-email', () => {
  it('flips status to pending_documents and enables login on a valid token', async () => {
    const { userId, applicationId, token } = await signUpFixture();

    const res = createRes();
    await handlePublicVerifyEmail(createReq({ body: { token } }), res);

    expect(res.statusCode).toBe(200);
    expect((res.body as { verified: boolean }).verified).toBe(true);

    const { data: app } = await admin
      .from('pending_applications')
      .select('status, email_verified_at, email_verification_token_hash')
      .eq('id', applicationId)
      .single();
    expect(app.status).toBe('pending_documents');
    expect(app.email_verified_at).toBeTruthy();
    expect(app.email_verification_token_hash).toBeNull();

    const { data: authUser } = await admin.auth.admin.getUserById(userId);
    expect(authUser.user?.email_confirmed_at).toBeTruthy();
  });

  it('rejects an invalid token generically', async () => {
    const res = createRes();
    await handlePublicVerifyEmail(createReq({ body: { token: 'not-a-real-token' } }), res);
    expect(res.statusCode).toBe(400);
    expect((res.body as { error: string }).error).toMatch(/invalid or has expired/);
  });

  it('rejects an expired token generically and leaves status untouched', async () => {
    const { applicationId, token } = await signUpFixture();
    await admin
      .from('pending_applications')
      .update({ email_verification_expires_at: new Date(Date.now() - 1000).toISOString() })
      .eq('id', applicationId);

    const res = createRes();
    await handlePublicVerifyEmail(createReq({ body: { token } }), res);
    expect(res.statusCode).toBe(400);

    const { data: app } = await admin
      .from('pending_applications')
      .select('status')
      .eq('id', applicationId)
      .single();
    expect(app.status).toBe('pending_email_verification');
  });

  it('rejects a reused (already-consumed) token', async () => {
    const { token } = await signUpFixture();
    await handlePublicVerifyEmail(createReq({ body: { token } }), createRes());

    const res2 = createRes();
    await handlePublicVerifyEmail(createReq({ body: { token } }), res2);
    expect(res2.statusCode).toBe(400);
  });

  it('rejects a missing token with a 400', async () => {
    const res = createRes();
    await handlePublicVerifyEmail(createReq({ body: {} }), res);
    expect(res.statusCode).toBe(400);
  });
});
