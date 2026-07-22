import type { Request, Response, NextFunction } from 'express';

interface Bucket {
  count: number;
  resetAt: number;
}

/**
 * In-memory fixed-window limiter factory — same shape as index.ts's per-IP
 * limiter, generalized so routes can layer additional, tighter-windowed
 * limiters keyed by something other than IP (e.g. normalized CR) on top of
 * the global one. Single-instance only, same known limit as the existing
 * limiter (resets on redeploy, no cross-instance sharing).
 */
export function createRateLimiter(opts: {
  windowMs: number;
  limit: number;
  keyFn: (req: Request) => string | null;
  message?: string;
}) {
  const buckets = new Map<string, Bucket>();

  setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of buckets) {
      if (now >= bucket.resetAt) buckets.delete(key);
    }
  }, 60_000).unref();

  return function rateLimit(req: Request, res: Response, next: NextFunction): void {
    const key = opts.keyFn(req);
    if (!key) {
      next();
      return;
    }
    const now = Date.now();
    const bucket = buckets.get(key);
    if (!bucket || now >= bucket.resetAt) {
      buckets.set(key, { count: 1, resetAt: now + opts.windowMs });
      next();
      return;
    }
    bucket.count++;
    if (bucket.count > opts.limit) {
      res.status(429).json({
        error: opts.message ?? 'Too many requests — try again later',
        code: 'RATE_LIMITED',
      });
      return;
    }
    next();
  };
}
