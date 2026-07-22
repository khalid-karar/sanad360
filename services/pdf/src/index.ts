// Load .env into process.env BEFORE any module that reads Supabase config.
import './lib/env.js';
import { pathToFileURL } from 'node:url';
import * as Sentry from '@sentry/node';
import express from 'express';

// Error tracking (launch-critical): no-op without SENTRY_DSN (local/CI).
// PDPL posture: no PII on events; request bodies are never attached.
if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.SENTRY_ENV ?? 'staging',
    sendDefaultPii: false,
    tracesSampleRate: 0.1,
  });
}
import type { Request, Response } from 'express';
import { authMiddleware } from './lib/auth.js';
import { handleSinglePickup } from './routes/single.js';
import { handleMonthly } from './routes/monthly.js';
import { handleMonthlyCompany } from './routes/monthly-company.js';
import { handleOnboardCompany } from './routes/onboard.js';
import { handleSweepExpiredConfirmations } from './routes/admin-sweep-confirmations.js';
import { handleSweepStaleApplications } from './routes/admin-sweep-applications.js';
import { handleInviteDriver } from './routes/invite-driver.js';
import { handleRevokeMembership } from './routes/revoke-membership.js';
import { handleInviteRecycler, handleCreateFacility } from './routes/invite-recycler.js';
import { handleIssueTripQr, handleValidateTripQr } from './routes/trip-qr.js';
import { handleIssueBranchQr } from './routes/branch-qr.js';
import { handlePublicSignup } from './routes/public-signup.js';
import { handlePublicVerifyEmail } from './routes/public-verify-email.js';
import { handleNotifyApplicationDecision } from './routes/admin-notify-application-decision.js';
import { createRateLimiter } from './lib/rateLimit.js';
import type { AuthedRequest } from './types.js';

const app = express();
const PORT = parseInt(process.env.PORT ?? '3001', 10);
const CORS_ORIGIN = process.env.CORS_ORIGIN ?? 'http://localhost:5173';

// Express 4 does not forward rejected promises from async handlers, so an
// unhandled rejection would crash the whole process. Wrap async handlers so any
// thrown error is converted to a structured 500 instead of taking the server down.
function asyncHandler(fn: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response): void => {
    fn(req, res).catch((err: unknown) => {
      console.error('[pdf-service] handler error:', err);
      if (process.env.SENTRY_DSN) Sentry.captureException(err);
      if (!res.headersSent) {
        res.status(500).json({
          error: err instanceof Error ? err.message : 'Internal error',
          code: 'INTERNAL_ERROR',
        });
      }
    });
  };
}

// ── Rate limiting (in-memory fixed window, per IP) ──────────────────────────
// PDF rendering is expensive; onboarding/invites are sensitive. A small
// per-IP budget stops both accidental burst loops and brute force.
const RATE_LIMIT = parseInt(process.env.RATE_LIMIT_PER_MINUTE ?? '60', 10);
const rateBuckets = new Map<string, { count: number; resetAt: number }>();

function rateLimiter(req: Request, res: Response, next: () => void): void {
  const ip = req.ip ?? 'unknown';
  const now = Date.now();
  const bucket = rateBuckets.get(ip);
  if (!bucket || now >= bucket.resetAt) {
    rateBuckets.set(ip, { count: 1, resetAt: now + 60_000 });
    next();
    return;
  }
  bucket.count++;
  if (bucket.count > RATE_LIMIT) {
    res.status(429).json({
      error: 'Too many requests — try again in a minute',
      code: 'RATE_LIMITED',
    });
    return;
  }
  next();
}
// Keep the map from growing unboundedly.
setInterval(() => {
  const now = Date.now();
  for (const [ip, b] of rateBuckets) {
    if (now >= b.resetAt) rateBuckets.delete(ip);
  }
}, 60_000).unref();

// ── Dedicated limits for the two unauthenticated CP5.5 routes ───────────────
// Layered ON TOP of the global per-IP limiter above — these are tighter and
// specific to the abuse shape of each route (signup: an attacker probing
// emails/CRs; verify: token brute force, though the 256-bit token space
// already makes that infeasible on its own).
const signupIpLimiter = createRateLimiter({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  keyFn: (req) => req.ip ?? null,
  message: 'Too many signup attempts from this address — try again in an hour',
});
const signupCrLimiter = createRateLimiter({
  windowMs: 24 * 60 * 60 * 1000,
  limit: 3,
  keyFn: (req) => {
    const cr = (req.body as { commercial_registration?: unknown } | undefined)?.commercial_registration;
    return typeof cr === 'string' && cr.trim() ? `cr:${cr.trim()}` : null;
  },
  message: 'Too many signup attempts for this commercial registration — try again tomorrow',
});
const verifyEmailIpLimiter = createRateLimiter({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  keyFn: (req) => req.ip ?? null,
  message: 'Too many verification attempts — try again later',
});

// ── Request timeout: two-pass renders take seconds, not minutes ─────────────
const REQUEST_TIMEOUT_MS = parseInt(process.env.REQUEST_TIMEOUT_MS ?? '90000', 10);
function requestTimeout(req: Request, res: Response, next: () => void): void {
  res.setTimeout(REQUEST_TIMEOUT_MS, () => {
    if (!res.headersSent) {
      res.status(503).json({
        error: 'PDF generation timed out',
        code: 'TIMEOUT',
      });
    }
  });
  next();
}

app.use(express.json({ limit: '1mb' }));

// CORS — only allow the frontend origin
app.use((_req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', CORS_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  next();
});
app.options('*', (_req, res) => { res.sendStatus(204); });

// Health check (no auth required)
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'sanad360-pdf', ts: new Date().toISOString() });
});

// Protected routes — JWT must be valid; all rate-limited + time-bounded.
app.post(
  '/generate/single-pickup',
  rateLimiter,
  requestTimeout,
  authMiddleware,
  asyncHandler((req, res) => handleSinglePickup(req as AuthedRequest, res))
);

app.post(
  '/generate/monthly-summary',
  rateLimiter,
  requestTimeout,
  authMiddleware,
  asyncHandler((req, res) => handleMonthly(req as AuthedRequest, res))
);

app.post(
  '/generate/monthly-company',
  rateLimiter,
  requestTimeout,
  authMiddleware,
  asyncHandler((req, res) => handleMonthlyCompany(req as AuthedRequest, res))
);

// Admin onboarding — does its own JWT + admin-membership check (NOT authMiddleware,
// which only requires *any* membership). Never exposes the service-role key.
app.post(
  '/admin/onboard-company',
  rateLimiter,
  requestTimeout,
  asyncHandler((req, res) => handleOnboardCompany(req, res))
);

// CP5 (migration 030): manual invocation of sweep_expired_pickup_confirmations()
// for staging/CP11 demo seeding — service-role or admin only, same
// not-the-shared-authMiddleware posture as onboarding above.
app.post(
  '/admin/sweep-expired-confirmations',
  rateLimiter,
  requestTimeout,
  asyncHandler((req, res) => handleSweepExpiredConfirmations(req, res))
);

// CP5.5 (migration 036): manual invocation of
// sweep_stale_unverified_applications() — same posture as the confirmations
// sweep above.
app.post(
  '/admin/sweep-stale-applications',
  rateLimiter,
  requestTimeout,
  asyncHandler((req, res) => handleSweepStaleApplications(req, res))
);

// Transport-side driver invitation (creates the driver's auth account +
// membership; role-checked inside the handler on top of authMiddleware).
app.post(
  '/transport/invite-driver',
  rateLimiter,
  requestTimeout,
  authMiddleware,
  asyncHandler((req, res) => handleInviteDriver(req as AuthedRequest, res))
);

// CP5 (migration 032): soft-revoke a company-side membership. Role-checked
// inside the handler (owner/manager of that exact company) on top of
// authMiddleware.
app.post(
  '/company/revoke-membership',
  rateLimiter,
  requestTimeout,
  authMiddleware,
  asyncHandler((req, res) => handleRevokeMembership(req as AuthedRequest, res))
);

// CP1: recycler onboarding. Role-checked inside the handler (admin, or a
// facility's own recycler_manager inviting a scale_operator) on top of
// authMiddleware.
app.post(
  '/admin/invite-recycler',
  rateLimiter,
  requestTimeout,
  authMiddleware,
  asyncHandler((req, res) => handleInviteRecycler(req as AuthedRequest, res))
);

app.post(
  '/admin/facilities',
  rateLimiter,
  requestTimeout,
  authMiddleware,
  asyncHandler((req, res) => handleCreateFacility(req as AuthedRequest, res))
);

// CP1: HMAC short-TTL trip QR — issue (transport staff / assigned driver)
// and validate (the receiving facility's own scale_operator/recycler_manager).
app.post(
  '/trips/:tripId/qr',
  rateLimiter,
  requestTimeout,
  authMiddleware,
  asyncHandler((req, res) => handleIssueTripQr(req as AuthedRequest, res))
);

app.post(
  '/recycler/validate-trip-qr',
  rateLimiter,
  requestTimeout,
  authMiddleware,
  asyncHandler((req, res) => handleValidateTripQr(req as AuthedRequest, res))
);

// CP3: HMAC short-TTL branch QR — issued to the branch's own device (owner/
// manager of the branch's company), rotated client-side before each 90s
// expiry. Replaces the old static, printable qr_token board (migration 022).
app.post(
  '/branches/:branchId/qr',
  rateLimiter,
  requestTimeout,
  authMiddleware,
  asyncHandler((req, res) => handleIssueBranchQr(req as AuthedRequest, res))
);

// CP5.5 (migration 041): public self-service signup — unauthenticated,
// info-only (no file upload; documents come later during pending_documents).
// Dedicated per-IP + per-CR limits layered on top of the global limiter.
app.post(
  '/public/signup',
  rateLimiter,
  signupIpLimiter,
  signupCrLimiter,
  requestTimeout,
  asyncHandler((req, res) => handlePublicSignup(req, res))
);

// CP5.5 (migration 041): email verification — unauthenticated. Body carries
// the raw token (not a query string) to keep it out of access logs.
app.post(
  '/public/verify-email',
  rateLimiter,
  verifyEmailIpLimiter,
  requestTimeout,
  asyncHandler((req, res) => handlePublicVerifyEmail(req, res))
);

// CP5.5: sends the approval/rejection email AFTER review_pending_application()
// (called directly by the frontend) has already committed the decision.
// Reviewer-role-gated on top of authMiddleware.
app.post(
  '/admin/notify-application-decision',
  rateLimiter,
  requestTimeout,
  authMiddleware,
  asyncHandler((req, res) => handleNotifyApplicationDecision(req as AuthedRequest, res))
);

// Only bind a real port + wire process-level signal/rejection handlers when
// this module is actually run as the server entrypoint (`tsx src/index.ts` /
// `node dist/index.js`). When imported (e.g. by an HTTP-level test driving
// `app` via supertest, which binds its own ephemeral port), none of this
// runs — the exported `app` is inert until something else listens on it.
const isMainModule = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;

if (isMainModule) {
  const server = app.listen(PORT, () => {
    console.log(`[pdf-service] Listening on http://localhost:${PORT}`);
    console.log(`[pdf-service] CORS origin: ${CORS_ORIGIN}`);
  });

  // ── Graceful shutdown (container/supervisor friendly) ─────────────────────
  // SIGTERM (docker stop / orchestrator) and SIGINT drain in-flight requests
  // before exit so a deploy never truncates a PDF mid-render.
  const shutdown = (signal: string): void => {
    console.log(`[pdf-service] ${signal} received — draining...`);
    server.close(() => {
      console.log('[pdf-service] drained, exiting.');
      process.exit(0);
    });
    // Hard stop if a hung render blocks the drain.
    setTimeout(() => process.exit(1), 30_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  process.on('unhandledRejection', (err) => {
    console.error('[pdf-service] unhandledRejection:', err);
    if (process.env.SENTRY_DSN) Sentry.captureException(err);
  });
}

export { app };
