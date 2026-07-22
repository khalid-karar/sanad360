import { describe, it, expect } from 'vitest';
import { createRateLimiter } from '../lib/rateLimit.js';
import { createReq, createRes } from './helpers.js';

describe('createRateLimiter', () => {
  it('allows up to the limit, then 429s within the window', () => {
    const limiter = createRateLimiter({ windowMs: 60_000, limit: 3, keyFn: () => 'k' });
    for (let i = 0; i < 3; i++) {
      const res = createRes();
      let called = false;
      limiter(createReq({}), res as never, () => {
        called = true;
      });
      expect(called).toBe(true);
    }
    const res = createRes();
    let called = false;
    limiter(createReq({}), res as never, () => {
      called = true;
    });
    expect(called).toBe(false);
    expect(res.statusCode).toBe(429);
    expect((res.body as { code: string }).code).toBe('RATE_LIMITED');
  });

  it('keys independently — one key exhausting its budget does not affect another', () => {
    const limiter = createRateLimiter({ windowMs: 60_000, limit: 1, keyFn: (req) => (req.body as { k?: string }).k ?? null });
    const resA1 = createRes();
    limiter(createReq({ body: { k: 'a' } }), resA1 as never, () => {});
    const resA2 = createRes();
    let calledA2 = false;
    limiter(createReq({ body: { k: 'a' } }), resA2 as never, () => {
      calledA2 = true;
    });
    expect(calledA2).toBe(false);

    const resB1 = createRes();
    let calledB1 = false;
    limiter(createReq({ body: { k: 'b' } }), resB1 as never, () => {
      calledB1 = true;
    });
    expect(calledB1).toBe(true);
  });

  it('passes through when keyFn returns null (nothing to key on)', () => {
    const limiter = createRateLimiter({ windowMs: 60_000, limit: 0, keyFn: () => null });
    const res = createRes();
    let called = false;
    limiter(createReq({}), res as never, () => {
      called = true;
    });
    expect(called).toBe(true);
  });
});
