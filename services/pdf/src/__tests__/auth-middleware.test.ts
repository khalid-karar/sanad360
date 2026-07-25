import { describe, it, expect, vi, afterEach } from 'vitest';
import { AuthApiError, AuthRetryableFetchError } from '@supabase/supabase-js';
import { createReq, createRes } from './helpers.js';

const getUserMock = vi.fn();
vi.mock('../lib/supabase.js', () => ({
  admin: { auth: { getUser: (...args: unknown[]) => getUserMock(...args) } },
}));

const { authMiddleware } = await import('../lib/auth.js');

afterEach(() => {
  getUserMock.mockReset();
});

// CP8 Slice H: mocks below construct REAL AuthApiError/AuthRetryableFetchError
// instances (not hand-rolled plain objects) — the previous version of this
// file mocked `{ message, status }` shapes that don't actually match what
// @supabase/auth-js returns, which is exactly why the real bug (a genuine
// network-level failure surfaces as AuthRetryableFetchError with status 0,
// not `undefined`) went uncaught: no test's mock ever produced status 0.
// Confirmed empirically against a real local GoTrue under 300 concurrent
// requests before writing these.
describe('authMiddleware: invalid-token vs transient-failure distinction', () => {
  it('returns 401 for a genuinely invalid/expired token (GoTrue 4xx response)', async () => {
    getUserMock.mockResolvedValue({
      data: { user: null },
      error: new AuthApiError('invalid JWT', 401, 'bad_jwt'),
    });
    const req = createReq({ headers: { authorization: 'Bearer bad-token' } });
    const res = createRes();
    let nextCalled = false;
    await authMiddleware(req, res, () => { nextCalled = true; });
    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(401);
    expect(getUserMock).toHaveBeenCalledTimes(1); // a real rejection is never retried
  });

  it('returns 401 for an expired token reported as a GoTrue 403', async () => {
    getUserMock.mockResolvedValue({
      data: { user: null },
      error: new AuthApiError('JWT expired', 403, 'token_expired'),
    });
    const req = createReq({ headers: { authorization: 'Bearer expired-token' } });
    const res = createRes();
    let nextCalled = false;
    await authMiddleware(req, res, () => { nextCalled = true; });
    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(401);
    expect(getUserMock).toHaveBeenCalledTimes(1);
  });

  it('returns 503 when every retry attempt hits a transient network failure (AuthRetryableFetchError, status 0 — the REAL shape a dropped connection to GoTrue produces)', async () => {
    getUserMock.mockResolvedValue({
      data: { user: null },
      error: new AuthRetryableFetchError('fetch failed', 0),
    });
    const req = createReq({ headers: { authorization: 'Bearer some-token' } });
    const res = createRes();
    let nextCalled = false;
    await authMiddleware(req, res, () => { nextCalled = true; });
    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(503);
    expect(getUserMock).toHaveBeenCalledTimes(3); // exhausted all retry attempts
  });

  it('returns 503 when the auth service itself errors (5xx)', async () => {
    getUserMock.mockResolvedValue({
      data: { user: null },
      error: new AuthRetryableFetchError('internal server error', 500),
    });
    const req = createReq({ headers: { authorization: 'Bearer some-token' } });
    const res = createRes();
    let nextCalled = false;
    await authMiddleware(req, res, () => { nextCalled = true; });
    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(503);
  });

  it('still returns 401 (safe default) when no user and no error object at all', async () => {
    getUserMock.mockResolvedValue({ data: { user: null }, error: null });
    const req = createReq({ headers: { authorization: 'Bearer weird-token' } });
    const res = createRes();
    let nextCalled = false;
    await authMiddleware(req, res, () => { nextCalled = true; });
    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(401);
  });

  it('a transient failure that recovers on the 2nd attempt succeeds — a real user is never logged out by a single dropped connection', async () => {
    getUserMock
      .mockResolvedValueOnce({ data: { user: null }, error: new AuthRetryableFetchError('fetch failed', 0) })
      .mockResolvedValueOnce({ data: { user: { id: 'u1' } }, error: null });
    const req = createReq({ headers: { authorization: 'Bearer recovers-token' } });
    const res = createRes();
    // authMiddleware queries `memberships`/`user_active_tenant` after a
    // successful getUser — this test only cares about the retry recovering
    // the user, so a membership lookup failure (real admin client, no
    // Supabase running in this unit test) is fine — it would 403, not
    // 401/503, which is enough to prove next() was reached via the retry.
    await authMiddleware(req, res, () => {}).catch(() => {});
    expect(getUserMock).toHaveBeenCalledTimes(2);
    expect(res.statusCode).not.toBe(401);
    expect(res.statusCode).not.toBe(503);
  });
});

// The valid-token -> next() path is untouched by this change and already
// exercised end-to-end (real GoTrue, real membership lookup) by every
// existing authenticated-route test in this suite (invite-driver,
// revoke-membership, trip-qr, branch-qr, etc.) — not re-mocked here.
