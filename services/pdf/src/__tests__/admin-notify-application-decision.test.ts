import { describe, it, expect, vi, afterEach } from 'vitest';
import { admin } from '../lib/supabase.js';
import { createReq, createRes, uniqueCr, uniqueEmail } from './helpers.js';
import type { AuthedRequest } from '../types.js';

const sendMock = vi.fn().mockResolvedValue(undefined);
vi.mock('../lib/email.js', () => ({
  send: (...args: unknown[]) => sendMock(...args),
}));

const { handleNotifyApplicationDecision } = await import('../routes/admin-notify-application-decision.js');

const cleanup: Array<() => Promise<void>> = [];

afterEach(async () => {
  sendMock.mockClear();
  for (const fn of cleanup.splice(0)) await fn();
});

function authedReq(body: unknown, memberRole: string): AuthedRequest {
  const base = createReq({ body });
  return Object.assign(base, {
    userId: 'test',
    companyId: null,
    transportCompanyId: null,
    facilityId: null,
    branchId: null,
    memberRole,
  }) as AuthedRequest;
}

async function createDecidedApplicationFixture(status: 'approved' | 'rejected') {
  const email = uniqueEmail();
  const { data: created } = await admin.auth.admin.createUser({
    email,
    password: 'correct-horse-battery',
    email_confirm: true,
  });
  const userId = created.user?.id as string;
  await admin.from('profiles').upsert({ id: userId, name_ar: 'Test Applicant' });

  const { data: company } = await admin
    .from('companies')
    .insert({ name_ar: 'شركة اختبار', commercial_registration: uniqueCr() })
    .select('id')
    .single();

  const { data: app } = await admin
    .from('pending_applications')
    .insert({
      applicant_user_id: userId,
      tenant_type: 'company',
      name_ar: 'شركة اختبار',
      name_en: 'Test Co',
      commercial_registration: uniqueCr(),
      contact_email: email,
      status,
      reviewed_by: userId,
      reviewed_at: new Date().toISOString(),
      reject_reason: status === 'rejected' ? 'Missing VAT certificate' : null,
      resulting_company_id: status === 'approved' ? company.id : null,
    })
    .select('id')
    .single();

  cleanup.push(async () => {
    await admin.from('pending_applications').delete().eq('id', app.id);
    await admin.from('companies').delete().eq('id', company.id);
    await admin.from('memberships').delete().eq('user_id', userId);
    await admin.auth.admin.deleteUser(userId).catch(() => {});
  });

  return { applicationId: app.id as string, email };
}

describe('POST /admin/notify-application-decision', () => {
  it('sends the approval email for an approved application', async () => {
    const { applicationId, email } = await createDecidedApplicationFixture('approved');
    const res = createRes();
    await handleNotifyApplicationDecision(authedReq({ application_id: applicationId }, 'document_reviewer'), res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ sent: true, status: 'approved' });
    expect(sendMock).toHaveBeenCalledTimes(1);
    const [to, template, , vars] = sendMock.mock.calls[0];
    expect(to).toBe(email);
    expect(template).toBe('approved');
    expect(vars).toEqual({ name: 'Test Co' });
  });

  it('sends the rejection email with the reject_reason for a rejected application', async () => {
    const { applicationId, email } = await createDecidedApplicationFixture('rejected');
    const res = createRes();
    await handleNotifyApplicationDecision(authedReq({ application_id: applicationId }, 'system_admin'), res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ sent: true, status: 'rejected' });
    const [to, template, , vars] = sendMock.mock.calls[0];
    expect(to).toBe(email);
    expect(template).toBe('rejected');
    expect(vars).toEqual({ name: 'Test Co', reason: 'Missing VAT certificate' });
  });

  it('rejects a non-reviewer role with 403 and never sends', async () => {
    const { applicationId } = await createDecidedApplicationFixture('approved');
    const res = createRes();
    await handleNotifyApplicationDecision(authedReq({ application_id: applicationId }, 'owner'), res);
    expect(res.statusCode).toBe(403);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('rejects an application not yet in a decided state', async () => {
    const email = uniqueEmail();
    const { data: created } = await admin.auth.admin.createUser({
      email,
      password: 'correct-horse-battery',
      email_confirm: true,
    });
    const userId = created.user?.id as string;
    await admin.from('profiles').upsert({ id: userId, name_ar: 'Test' });
    const { data: app } = await admin
      .from('pending_applications')
      .insert({
        applicant_user_id: userId,
        tenant_type: 'company',
        name_ar: 'شركة',
        commercial_registration: uniqueCr(),
        contact_email: email,
        status: 'pending_review',
      })
      .select('id')
      .single();
    cleanup.push(async () => {
      await admin.from('pending_applications').delete().eq('id', app.id);
      await admin.auth.admin.deleteUser(userId).catch(() => {});
    });

    const res = createRes();
    await handleNotifyApplicationDecision(authedReq({ application_id: app.id }, 'document_reviewer'), res);
    expect(res.statusCode).toBe(400);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('does not throw and reports sent:false when SES send fails (no rollback of anything)', async () => {
    sendMock.mockRejectedValueOnce(new Error('SES down'));
    const { applicationId } = await createDecidedApplicationFixture('approved');
    const res = createRes();
    await handleNotifyApplicationDecision(authedReq({ application_id: applicationId }, 'document_reviewer'), res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ sent: false, status: 'approved' });
  });
});
