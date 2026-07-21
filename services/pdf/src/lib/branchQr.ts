import { createHmac } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

// Issues short-TTL, HMAC-signed branch QR tokens (migration 022/Part B).
//
// Deliberately NOT a branchQr/tripQr shared abstraction: this has a
// different trust model than services/pdf/src/lib/tripQr.ts — the signing
// secret is a per-branch DB-held value (branches.qr_token), fetched fresh
// per request via the service-role client, not a static process.env secret.
// It's issue-only: verification happens exclusively in Postgres
// (pickup_events_before_insert, migration 022/B4), never here.
//
// Encoding is PLAIN base64 (Buffer.toString('base64')), NOT base64url —
// migration 022's decision 6: Postgres's encode()/decode() must match this
// byte-for-byte, and encode(...,'base64') is standard base64, not url-safe.
const DEFAULT_TTL_SECONDS = 90;

export interface IssuedBranchQr {
  token: string;
  expires_at: string; // ISO
}

interface BranchQrPayload {
  branch_id: string;
  exp: number; // epoch ms
}

export async function issueBranchQrToken(
  admin: SupabaseClient,
  branchId: string,
  ttlSeconds = DEFAULT_TTL_SECONDS
): Promise<IssuedBranchQr | null> {
  const { data: branch, error } = await admin
    .from('branches')
    .select('qr_token')
    .eq('id', branchId)
    .maybeSingle<{ qr_token: string }>();

  if (error || !branch) return null;

  const exp = Date.now() + ttlSeconds * 1000;
  const payload: BranchQrPayload = { branch_id: branchId, exp };
  const payloadB64 = Buffer.from(JSON.stringify(payload), 'utf-8').toString('base64');
  const sigB64 = createHmac('sha256', branch.qr_token).update(payloadB64, 'utf-8').digest('base64');

  return { token: `${payloadB64}.${sigB64}`, expires_at: new Date(exp).toISOString() };
}
