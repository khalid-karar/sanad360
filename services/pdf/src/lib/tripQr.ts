import { createHmac, timingSafeEqual } from 'node:crypto';

// Stateless, short-TTL, HMAC-signed trip QR tokens.
//
// The driver app renders `trip_id` as a QR at dropoff; the recycler's scale
// scans it and POSTs the token to /recycler/validate-trip-qr. The token is
// NEVER just the raw trip_id (that would let anyone who sees a photo of the
// QR code — or a curious driver — impersonate any trip by typing its UUID).
// Instead it's payload.signature, where payload = base64url({trip_id, exp})
// and signature = HMAC-SHA256(payload, TRIP_QR_SECRET). The secret never
// leaves this server, so a token cannot be forged or replayed past its
// expiry, and a stale/reused QR photo stops working once exp passes.
const DEFAULT_TTL_SECONDS = 120;

const SECRET = process.env.TRIP_QR_SECRET
  ?? (process.env.NODE_ENV === 'production' ? undefined : 'dev-only-insecure-trip-qr-secret-change-me');

if (!SECRET) {
  throw new Error('TRIP_QR_SECRET must be set in production');
}

function base64url(input: Buffer | string): string {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf-8') : input;
  return buf.toString('base64url');
}

interface TripQrPayload {
  trip_id: string;
  exp: number; // epoch ms
}

export interface IssuedTripQr {
  token: string;
  expires_at: string; // ISO
}

export function issueTripQrToken(tripId: string, ttlSeconds = DEFAULT_TTL_SECONDS): IssuedTripQr {
  const exp = Date.now() + ttlSeconds * 1000;
  const payload: TripQrPayload = { trip_id: tripId, exp };
  const payloadB64 = base64url(JSON.stringify(payload));
  const signature = base64url(createHmac('sha256', SECRET!).update(payloadB64).digest());
  return { token: `${payloadB64}.${signature}`, expires_at: new Date(exp).toISOString() };
}

export type TripQrValidation =
  | { ok: true; tripId: string }
  | { ok: false; reason: 'malformed' | 'tampered' | 'expired' };

export function verifyTripQrToken(token: string): TripQrValidation {
  const parts = token.split('.');
  if (parts.length !== 2) return { ok: false, reason: 'malformed' };
  const [payloadB64, signature] = parts;

  const expectedSignature = base64url(createHmac('sha256', SECRET!).update(payloadB64).digest());
  const sigBuf = Buffer.from(signature);
  const expectedBuf = Buffer.from(expectedSignature);
  if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) {
    return { ok: false, reason: 'tampered' };
  }

  let payload: TripQrPayload;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf-8')) as TripQrPayload;
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (typeof payload.trip_id !== 'string' || typeof payload.exp !== 'number') {
    return { ok: false, reason: 'malformed' };
  }
  if (Date.now() > payload.exp) {
    return { ok: false, reason: 'expired' };
  }

  return { ok: true, tripId: payload.trip_id };
}
