#!/usr/bin/env node
/**
 * PDPL driver-erasure runbook (see PDPL_ERASURE.md).
 *
 *   node scripts/pdpl-erase.mjs <driver_id> "<reason>"
 *
 * 1. erase_driver_pii() (migration 015, service-role-only RPC): tombstones
 *    drivers + profiles, deletes memberships/tenant-selection/notifications,
 *    writes the append-only erasure_log row.
 * 2. Disables the GoTrue account: scrambled email, random password,
 *    permanent ban. The auth row is NOT deleted (its cascade would collide
 *    with the ledger's profile FK) — it is rendered unusable and identity-free.
 *
 * Idempotent: safe to re-run.
 */
import { createClient } from '@supabase/supabase-js';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Minimal .env loader (same approach as the test setup).
try {
  for (const line of readFileSync(resolve(process.cwd(), '.env'), 'utf-8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i > 0 && !(t.slice(0, i) in process.env)) process.env[t.slice(0, i)] = t.slice(i + 1);
  }
} catch { /* env must come from the shell */ }

const [, , driverId, reason] = process.argv;
if (!driverId) {
  console.error('usage: node scripts/pdpl-erase.mjs <driver_id> "<reason>"');
  process.exit(1);
}

const url = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Set VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment.');
  process.exit(1);
}

const admin = createClient(url, key, { auth: { persistSession: false } });

// 1. Database-side erasure (tombstones + log).
const { data, error } = await admin.rpc('erase_driver_pii', {
  p_driver_id: driverId,
  p_reason: reason ?? null,
});
if (error) {
  console.error('✗ erase_driver_pii failed:', error.message);
  process.exit(1);
}
console.log('✓ database erasure:', JSON.stringify(data));

// 2. Disable the auth account, if one was linked.
const profileId = data?.profile_id;
if (profileId) {
  const scrambled = `erased-${randomBytes(8).toString('hex')}@erased.invalid`;
  const { error: authErr } = await admin.auth.admin.updateUserById(profileId, {
    email: scrambled,
    password: randomBytes(24).toString('hex'),
    phone: null,
    user_metadata: {},
    ban_duration: '876000h', // ~100 years
  });
  if (authErr) {
    console.error('✗ auth disable failed (DB erasure already done):', authErr.message);
    process.exit(1);
  }
  console.log(`✓ auth account disabled (${profileId} → ${scrambled}, banned)`);
} else {
  console.log('ℹ no linked auth account (driver was never invited)');
}

console.log('DONE — erasure logged in public.erasure_log.');
