// Load .env into process.env BEFORE any module that reads Supabase config.
import './lib/env.js';
import express from 'express';
import { authMiddleware } from './lib/auth.js';
import { handleSinglePickup } from './routes/single.js';
import { handleMonthly } from './routes/monthly.js';
import { handleOnboardCompany } from './routes/onboard.js';
import type { AuthedRequest } from './types.js';

const app = express();
const PORT = parseInt(process.env.PORT ?? '3001', 10);
const CORS_ORIGIN = process.env.CORS_ORIGIN ?? 'http://localhost:5173';

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
  (req, res) => handleSinglePickup(req as AuthedRequest, res)
);

app.post(
  '/generate/monthly-summary',
  authMiddleware,
  (req, res) => handleMonthly(req as AuthedRequest, res)
);

// Admin onboarding — does its own JWT + admin-membership check (NOT authMiddleware,
// which only requires *any* membership). Never exposes the service-role key.
app.post('/admin/onboard-company', (req, res) => handleOnboardCompany(req, res));

app.listen(PORT, () => {
  console.log(`[pdf-service] Listening on http://localhost:${PORT}`);
  console.log(`[pdf-service] CORS origin: ${CORS_ORIGIN}`);
});
