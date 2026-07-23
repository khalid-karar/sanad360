import { describe, it, expect, vi, afterEach } from 'vitest';
import { createReq, createRes } from './helpers.js';

const getUserMock = vi.fn();
vi.mock('../lib/supabase.js', () => ({
  admin: { auth: { getUser: (...args: unknown[]) => getUserMock(...args) } },
}));

const { authMiddleware } = await import('../lib/auth.js');

afterEach(() => {
  getUserMock.mockReset();
});

describe('authMiddleware: invalid-token vs transient-failure distinction', () => {
  it('returns 401 for a genuinely invalid/expired token (GoTrue 4xx response)', async () => {
    getUserMock.mockResolvedValue({
      data: { user: null },
      error: { message: 'invalid JWT', status: 401 },
    });
    const req = createReq({ headers: { authorization: 'Bearer bad-token' } });
    const res = createRes();
    let nextCalled = false;
    await authMiddleware(req, res, () => { nextCalled = true; });
    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(401);
  });

  it('returns 401 for an expired token reported as a GoTrue 403', async () => {
    getUserMock.mockResolvedValue({
      data: { user: null },
      error: { message: 'JWT expired', status: 403 },
    });
    const req = createReq({ headers: { authorization: 'Bearer expired-token' } });
    const res = createRes();
    let nextCalled = false;
    await authMiddleware(req, res, () => { nextCalled = true; });
    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(401);
  });

  it('returns 503 when the auth service fails before returning any response (no status)', async () => {
    getUserMock.mockResolvedValue({
      data: { user: null },
      error: { message: 'fetch failed', status: undefined },
    });
    const req = createReq({ headers: { authorization: 'Bearer some-token' } });
    const res = createRes();
    let nextCalled = false;
    await authMiddleware(req, res, () => { nextCalled = true; });
    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(503);
  });

  it('returns 503 when the auth service itself errors (5xx)', async () => {
    getUserMock.mockResolvedValue({
      data: { user: null },
      error: { message: 'internal server error', status: 500 },
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
});

// The valid-token -> next() path is untouched by this change and already
// exercised end-to-end (real GoTrue, real membership lookup) by every
// existing authenticated-route test in this suite (invite-driver,
// revoke-membership, trip-qr, branch-qr, etc.) — not re-mocked here.
