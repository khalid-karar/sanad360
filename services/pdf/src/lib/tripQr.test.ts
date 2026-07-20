import { describe, it, expect } from 'vitest';
import { issueTripQrToken, verifyTripQrToken } from './tripQr.js';

describe('Trip QR (HMAC short-TTL token)', () => {
  it('issues a token that verifies back to the same trip id', () => {
    const { token } = issueTripQrToken('11111111-1111-1111-1111-111111111111');
    const result = verifyTripQrToken(token);
    expect(result).toEqual({ ok: true, tripId: '11111111-1111-1111-1111-111111111111' });
  });

  it('rejects a tampered payload (trip id swapped, signature unchanged)', () => {
    const { token } = issueTripQrToken('11111111-1111-1111-1111-111111111111');
    const [payload, signature] = token.split('.');
    const forgedPayload = Buffer.from(
      JSON.stringify({ trip_id: '22222222-2222-2222-2222-222222222222', exp: Date.now() + 60_000 })
    ).toString('base64url');
    expect(forgedPayload).not.toBe(payload);
    const forged = `${forgedPayload}.${signature}`;
    const result = verifyTripQrToken(forged);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('tampered');
  });

  it('rejects an expired token', () => {
    const { token } = issueTripQrToken('11111111-1111-1111-1111-111111111111', -1);
    const result = verifyTripQrToken(token);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('expired');
  });

  it('rejects a malformed token', () => {
    expect(verifyTripQrToken('not-a-real-token')).toEqual({ ok: false, reason: 'malformed' });
    expect(verifyTripQrToken('')).toEqual({ ok: false, reason: 'malformed' });
  });
});
