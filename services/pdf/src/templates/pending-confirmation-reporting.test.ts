import { describe, it, expect } from 'vitest';
import { computeStats } from './monthly-summary.js';
import { stats as branchStats } from './monthly-company.js';
import { buildSinglePickupHtml } from './single-pickup.js';
import type {
  PickupEventRow, CompanyRow, BranchRow, TransportCompanyRow, DriverRow, VehicleRow,
} from '../types.js';
import type { BranchSection } from './monthly-company.js';

/**
 * pending_confirmation aggregation (Migration 030, CP5 review item 1b/1d)
 *
 * Before this fix, `pending_confirmation` events incremented totalPickups/
 * total but matched none of the independent `if`s for compliant/warning/
 * non_compliant — silently vanishing from every visible bucket while still
 * counting toward the total (compliant + warning + nonCompliant < total,
 * with no bucket showing the gap). This proves the fix: it's now its own
 * exhaustive bucket, and totals reconcile exactly.
 */

function fakeEvent(overrides: Partial<PickupEventRow> = {}): PickupEventRow {
  return {
    id: crypto.randomUUID(),
    logical_id: crypto.randomUUID(),
    revision: 1,
    company_id: 'c1',
    branch_id: 'b1',
    transport_company_id: 't1',
    driver_id: 'd1',
    vehicle_id: 'v1',
    trip_id: null,
    waste_types: ['organic'],
    weight_kg: 10,
    gps_lat: null,
    gps_lng: null,
    geofence_verified: true,
    qr_verified: true,
    qr_code_value: null,
    qr_skip_reason: null,
    qr_skip_reason_notes: null,
    photo_path: 'p.jpg',
    scale_photo_path: null,
    receipt_path: null,
    signature_path: 's.png',
    photo_sha256: null,
    scale_photo_sha256: null,
    receipt_sha256: null,
    signature_sha256: null,
    risk_score: 0,
    risk_flags: [],
    compliance_status: 'compliant',
    notes: null,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

describe('monthly-summary computeStats — pending_confirmation bucket', () => {
  it('is excluded from compliant/warning/non_compliant AND totals reconcile', () => {
    const events = [
      fakeEvent({ compliance_status: 'compliant' }),
      fakeEvent({ compliance_status: 'warning' }),
      fakeEvent({ compliance_status: 'non_compliant' }),
      fakeEvent({ compliance_status: 'pending_confirmation' }),
      fakeEvent({ compliance_status: 'pending_confirmation' }),
    ];

    const s = computeStats(events);
    expect(s.totalPickups).toBe(5);
    expect(s.compliant).toBe(1);
    expect(s.warning).toBe(1);
    expect(s.nonCompliant).toBe(1);
    expect(s.pendingConfirmation).toBe(2);
    // The reconciliation invariant CP5 asked for.
    expect(s.compliant + s.warning + s.nonCompliant + s.pendingConfirmation).toBe(s.totalPickups);
  });

  it('a pending pickup is never counted as compliant', () => {
    const s = computeStats([fakeEvent({ compliance_status: 'pending_confirmation', risk_score: 0 })]);
    expect(s.compliant).toBe(0);
    expect(s.pendingConfirmation).toBe(1);
  });
});

describe('monthly-company stats() — pending_confirmation bucket, per branch and company-wide', () => {
  it('per-branch stats reconcile and the company-wide totals (summed by the route) would too', () => {
    const section: BranchSection = {
      branch: { id: 'b1', name_ar: 'فرع', address_ar: null, city: null } as BranchSection['branch'],
      events: [
        fakeEvent({ compliance_status: 'compliant' }),
        fakeEvent({ compliance_status: 'pending_confirmation' }),
        fakeEvent({ compliance_status: 'non_compliant' }),
      ],
      custodyConfirmedIds: [],
    };

    const st = branchStats(section);
    expect(st.total).toBe(3);
    expect(st.compliant).toBe(1);
    expect(st.nonCompliant).toBe(1);
    expect(st.pendingConfirmation).toBe(1);
    expect(st.compliant + st.warning + st.nonCompliant + st.pendingConfirmation).toBe(st.total);
  });
});

describe('buildSinglePickupHtml — pending_confirmation renders distinctly (never compliant, never blank)', () => {
  // Tested at the HTML-string level, not via PDF render + text extraction:
  // pdf-parse reorders/reshapes Arabic glyphs on extraction (a known
  // limitation the rest of this suite already works around — see
  // phase2-acceptance.test.ts's "MANUAL CHECK required" comments — so
  // asserting on a literal Arabic phrase from extracted PDF text is
  // unreliable). The raw template string has none of that loss.
  const company = { id: 'c1', name_ar: 'شركة', commercial_registration: '123', vat_number: null } as CompanyRow;
  const branch = { id: 'b1', name_ar: 'فرع', address_ar: null, city: null } as BranchRow;
  const transport = { id: 't1', name_ar: 'نقل', ncwm_license_number: null, ncwm_license_expiry: '2030-01-01' } as TransportCompanyRow;
  const driver = { id: 'd1', name_ar: 'سائق', license_number: 'L1', license_expiry: '2030-01-01' } as DriverRow;
  const vehicle = { id: 'v1', plate_number: 'P1', type: 'medium_truck', ncwm_license_number: null, ncwm_license_expiry: '2030-01-01' } as VehicleRow;

  function pendingEvent(): PickupEventRow {
    return {
      id: crypto.randomUUID(),
      logical_id: crypto.randomUUID(),
      revision: 1,
      company_id: 'c1',
      branch_id: 'b1',
      transport_company_id: 't1',
      driver_id: 'd1',
      vehicle_id: 'v1',
      trip_id: null,
      waste_types: ['organic'],
      weight_kg: 10,
      gps_lat: 24.6877,
      gps_lng: 46.6876,
      geofence_verified: true,
      qr_verified: false,
      qr_code_value: null,
      qr_skip_reason: 'not_applicable_for_stream',
      qr_skip_reason_notes: null,
      photo_path: 'p.jpg',
      scale_photo_path: null,
      receipt_path: null,
      signature_path: 's.png',
      photo_sha256: null,
      scale_photo_sha256: null,
      receipt_sha256: null,
      signature_sha256: null,
      risk_score: 0,
      risk_flags: ['missing_required_evidence', 'missing_required:branch_confirmation', 'awaiting_branch_confirmation'],
      compliance_status: 'pending_confirmation',
      notes: null,
      created_at: new Date().toISOString(),
    };
  }

  it('renders the pending badge/label and the branch-confirmation section — never the compliant badge', () => {
    const html = buildSinglePickupHtml({
      event: pendingEvent(),
      company, branch, transport, driver, vehicle,
      evidence: { photo: null, receipt: null, signature: null, scale: null },
      branchConfirmation: null,
      documentId: 'DOC1',
      generatedAt: new Date().toISOString(),
    });

    expect(html).toContain('badge-pending_confirmation');
    expect(html).toContain('بانتظار تأكيد الفرع');
    // The dedicated branch-confirmation section is present and shows the
    // outstanding-party message, not silently omitted.
    expect(html).toContain('تأكيد فرع الاستلام');
    expect(html).toContain('بانتظار تأكيد مشغّل الفرع');
    // Never the compliant badge for THIS event.
    expect(html).not.toContain('class="risk-badge badge-compliant"');
  });

  it('a confirmation_window_expired pending pickup shows the expiry message, not "still awaiting"', () => {
    const event = pendingEvent();
    event.compliance_status = 'non_compliant';
    event.risk_flags = ['missing_required_evidence', 'missing_required:branch_confirmation', 'confirmation_window_expired'];

    const html = buildSinglePickupHtml({
      event, company, branch, transport, driver, vehicle,
      evidence: { photo: null, receipt: null, signature: null, scale: null },
      branchConfirmation: null,
      documentId: 'DOC2',
      generatedAt: new Date().toISOString(),
    });

    expect(html).toContain('انتهت مهلة تأكيد الفرع');
    expect(html).not.toContain('لم يرد أي تأكيد بعد');
  });
});
