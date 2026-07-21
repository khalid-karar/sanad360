/**
 * QR skip-reason enforcement (Migration 022)
 *
 * pickup_events_qr_or_reason_check requires qr_code_value OR qr_skip_reason
 * on every insert (NOT VALID — enforced from 022 forward, not against
 * history). pickup_events_skip_reason_notes_check additionally requires
 * qr_skip_reason_notes to be non-empty whenever qr_skip_reason = 'other'.
 *
 * Assertions:
 *   1. Neither qr_code_value nor qr_skip_reason → CHECK violation (23514)
 *   2. Each of the 4 valid qr_skip_reason values alone → succeeds,
 *      qr_skipped_with_reason flag present
 *   3. qr_skip_reason='other' with empty/whitespace notes → CHECK violation
 *   4. qr_skip_reason='other' with real notes → succeeds
 *   5. Both qr_code_value AND qr_skip_reason present → succeeds (OR, not XOR)
 */

import { createClient } from '@supabase/supabase-js';
import { describe, it, expect, afterAll } from 'vitest';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

if (!SERVICE_KEY) {
  throw new Error('Set SUPABASE_SERVICE_ROLE_KEY in .env before running tests.');
}

const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const SEED = {
  companyId: 'a0000000-0000-0000-0000-000000000001',
  branchId: 'b0000000-0000-0000-0000-000000000001',
  transportCompanyId: 'c0000000-0000-0000-0000-000000000001',
  driverId: 'd0000000-0000-0000-0000-000000000001',
  vehicleId: 'e0000000-0000-0000-0000-000000000001',
};

const cleanupEventIds: string[] = [];

function basePayload(overrides: Record<string, unknown> = {}) {
  return {
    logical_id: crypto.randomUUID(),
    revision: 1,
    company_id: SEED.companyId,
    branch_id: SEED.branchId,
    transport_company_id: SEED.transportCompanyId,
    driver_id: SEED.driverId,
    vehicle_id: SEED.vehicleId,
    waste_types: ['organic'],
    weight_kg: 10,
    photo_path: 'p/photo.jpg',
    signature_path: 'p/sig.png',
    ...overrides,
  };
}

async function insertEvent(overrides: Record<string, unknown> = {}) {
  const { data, error } = await admin
    .from('pickup_events')
    .insert(basePayload(overrides))
    .select('id, risk_flags')
    .single<{ id: string; risk_flags: string[] }>();
  if (data) cleanupEventIds.push(data.id);
  return { data, error };
}

describe('QR skip-reason enforcement (Migration 022)', () => {
  afterAll(async () => {
    if (cleanupEventIds.length) {
      await admin.from('pickup_events').delete().in('id', cleanupEventIds);
    }
  });

  it('1. neither qr_code_value nor qr_skip_reason → CHECK violation', async () => {
    const { data, error } = await insertEvent();
    expect(data).toBeNull();
    expect(error).not.toBeNull();
    expect(error!.code).toBe('23514');
    expect(error!.message).toContain('pickup_events_qr_or_reason_check');
  });

  it.each([
    'device_unavailable',
    'scan_failed',
    'not_applicable_for_stream',
  ] as const)('2. qr_skip_reason=%s alone succeeds with qr_skipped_with_reason flag', async (reason) => {
    const { data, error } = await insertEvent({ qr_skip_reason: reason });
    expect(error).toBeNull();
    expect(data).not.toBeNull();
    expect(data!.risk_flags).toContain('qr_skipped_with_reason');
  });

  it("3. qr_skip_reason='other' with empty notes → CHECK violation", async () => {
    const { data, error } = await insertEvent({ qr_skip_reason: 'other', qr_skip_reason_notes: '   ' });
    expect(data).toBeNull();
    expect(error).not.toBeNull();
    expect(error!.code).toBe('23514');
    expect(error!.message).toContain('pickup_events_skip_reason_notes_check');
  });

  it("4. qr_skip_reason='other' with real notes succeeds", async () => {
    const { data, error } = await insertEvent({
      qr_skip_reason: 'other',
      qr_skip_reason_notes: 'Branch device was stolen the night before.',
    });
    expect(error).toBeNull();
    expect(data).not.toBeNull();
    expect(data!.risk_flags).toContain('qr_skipped_with_reason');
  });

  it('5. both qr_code_value AND qr_skip_reason present succeeds (OR, not XOR)', async () => {
    const { data, error } = await insertEvent({
      qr_code_value: `NOT-A-REAL-TOKEN-${Date.now()}`,
      qr_skip_reason: 'scan_failed',
    });
    expect(error).toBeNull();
    expect(data).not.toBeNull();
  });
});
