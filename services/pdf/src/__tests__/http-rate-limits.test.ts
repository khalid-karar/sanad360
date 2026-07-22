import { describe, it, expect, vi, afterEach } from 'vitest';
import request from 'supertest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { admin } from '../lib/supabase.js';
import { uniqueCr, uniqueEmail } from './helpers.js';

// The real SES send() is mocked (no network calls) — this file is testing
// the HTTP/middleware layer (real Express app, real supertest requests,
// real DB writes via the service_role client), not email delivery.
const sendMock = vi.fn().mockResolvedValue(undefined);
vi.mock('../lib/email.js', () => ({
  send: (...args: unknown[]) => sendMock(...args),
}));

// Each test gets a FRESH copy of index.ts (and everything it imports,
// including lib/rateLimit.ts's in-memory Maps) via vi.resetModules() + a
// dynamic re-import — otherwise the module-level rate-limit buckets would
// carry state over between tests and contaminate each other (they're
// exactly the kind of process-lifetime state a real deploy would also
// reset only on restart). Also re-imports lib/supabase.ts from the SAME
// fresh module graph so a spy on `.rpc` intercepts the calls the freshly
// loaded route handlers actually make (a spy on the file's static `admin`
// import would be a different object after resetModules()).
async function freshApp(): Promise<{ app: import('express').Express; admin: SupabaseClient }> {
  vi.resetModules();
  const [{ app }, { admin: freshAdmin }] = await Promise.all([
    import('../index.js'),
    import('../lib/supabase.js'),
  ]);
  return { app, admin: freshAdmin };
}

function validCompanyBody(overrides: Record<string, unknown> = {}) {
  return {
    tenant_type: 'company',
    name_ar: 'شركة تجريبية',
    commercial_registration: uniqueCr(),
    industry_code: 'healthcare',
    contact_email: uniqueEmail(),
    password: 'correct-horse-battery',
    ...overrides,
  };
}

async function findUserIdByEmail(email: string): Promise<string | null> {
  const { data } = await admin.auth.admin.listUsers({ perPage: 200 });
  return data.users.find((u) => u.email === email)?.id ?? null;
}

const createdEmails: string[] = [];

afterEach(async () => {
  sendMock.mockClear();
  for (const email of createdEmails.splice(0)) {
    const id = await findUserIdByEmail(email);
    if (id) {
      await admin.from('pending_applications').delete().eq('applicant_user_id', id);
      await admin.from('memberships').delete().eq('user_id', id);
      await admin.auth.admin.deleteUser(id).catch(() => {});
    }
  }
});

describe('HTTP-level rate limits (real Express app via supertest)', () => {
  it('signup: allows 5/hr/IP, 429s the 6th, and the 6th never reaches the handler', async () => {
    const { app } = await freshApp();

    for (let i = 0; i < 5; i++) {
      const body = validCompanyBody();
      createdEmails.push(body.contact_email as string);
      const res = await request(app).post('/public/signup').send(body);
      expect(res.status).toBe(202);
    }

    const sixthBody = validCompanyBody();
    const res = await request(app).post('/public/signup').send(sixthBody);
    expect(res.status).toBe(429);
    expect(res.body.code).toBe('RATE_LIMITED');

    // Proves ordering (limiter before handler): no auth user exists for
    // the blocked 6th request's email — the handler never ran.
    const blockedUserId = await findUserIdByEmail(sixthBody.contact_email as string);
    expect(blockedUserId).toBeNull();
  }, 30000);

  it('signup: allows 3/day per normalized CR (whitespace variants share one bucket), 429s the 4th', async () => {
    const { app } = await freshApp();
    const cr = uniqueCr();
    // Same CR, deliberately padded with whitespace on 2 of the 3 — proves
    // the limiter key normalizes (trims) before bucketing, matching the
    // trimmed value actually persisted to pending_applications.
    const variants = [cr, `  ${cr}`, `${cr}  `];

    for (const variant of variants) {
      const body = validCompanyBody({ commercial_registration: variant });
      createdEmails.push(body.contact_email as string);
      const res = await request(app).post('/public/signup').send(body);
      // All 3 pass the limiter (still 202 — the 2nd/3rd separately collide
      // on the DB's CR-uniqueness index and fold into the same ambiguous
      // 202 the handler already returns for that case; what matters here
      // is none of them is a 429).
      expect(res.status).toBe(202);
    }

    const fourthBody = validCompanyBody({ commercial_registration: cr });
    createdEmails.push(fourthBody.contact_email as string);
    const res = await request(app).post('/public/signup').send(fourthBody);
    expect(res.status).toBe(429);
    expect(res.body.code).toBe('RATE_LIMITED');

    // 4th request never reached the handler — no auth user for its email.
    const blockedUserId = await findUserIdByEmail(fourthBody.contact_email as string);
    expect(blockedUserId).toBeNull();
  }, 30000);

  it('verify-email: allows 10/hr/IP, 429s the 11th, and the 11th never calls the RPC', async () => {
    const { app, admin: freshAdmin } = await freshApp();
    const rpcSpy = vi.spyOn(freshAdmin, 'rpc');

    for (let i = 0; i < 10; i++) {
      const res = await request(app).post('/public/verify-email').send({ token: 'not-a-real-token' });
      expect(res.status).toBe(400);
    }
    expect(rpcSpy).toHaveBeenCalledTimes(10);

    const res = await request(app).post('/public/verify-email').send({ token: 'not-a-real-token' });
    expect(res.status).toBe(429);
    expect(res.body.code).toBe('RATE_LIMITED');
    // Blocked request never invoked verify_application_email — call count
    // unchanged from before this 11th request.
    expect(rpcSpy).toHaveBeenCalledTimes(10);

    rpcSpy.mockRestore();
  }, 30000);
});
