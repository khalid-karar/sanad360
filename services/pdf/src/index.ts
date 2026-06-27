// Load .env into process.env BEFORE any module that reads Supabase config.
import './lib/env.js';
import express from 'express';
import type { Request, Response } from 'express';
import { authMiddleware } from './lib/auth.js';
import { handleSinglePickup } from './routes/single.js';
import { handleMonthly } from './routes/monthly.js';
import { handleOnboardCompany } from './routes/onboard.js';
import type { AuthedRequest } from './types.js';

const app = express();
const PORT = parseInt(process.env.PORT ?? '3001', 10);
const CORS_ORIGIN = process.env.CORS_ORIGIN ?? 'http://localhost:5173';

// Express 4 does not forward rejected promises from async handlers, so an
// unhandled rejection would crash the whole process. Wrap async handlers so any
// thrown error is converted to a 500 response instead of taking the server down.
function asyncHandler(fn: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response): void => {
    fn(req, res).catch((err: unknown) => {
      console.error('[pdf-service] handler error:', err);
      if (!res.headersSent) {
        res.status(500).json({ error: err instanceof Error ? err.message : 'Internal error' });
      }
    });
  };
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
  res.json({ status: 'ok', service: 'tadweer360-pdf', ts: new Date().toISOString() });
});

// Protected routes — JWT must be valid
app.post(
  '/generate/single-pickup',
  authMiddleware,
  asyncHandler((req, res) => handleSinglePickup(req as AuthedRequest, res))
);

app.post(
  '/generate/monthly-summary',
  authMiddleware,
  asyncHandler((req, res) => handleMonthly(req as AuthedRequest, res))
);

// Admin onboarding — does its own JWT + admin-membership check (NOT authMiddleware,
// which only requires *any* membership). Never exposes the service-role key.
app.post('/admin/onboard-company', asyncHandler((req, res) => handleOnboardCompany(req, res)));

app.listen(PORT, () => {
  console.log(`[pdf-service] Listening on http://localhost:${PORT}`);
  console.log(`[pdf-service] CORS origin: ${CORS_ORIGIN}`);
});
