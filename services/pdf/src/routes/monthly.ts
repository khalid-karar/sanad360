import type { Response } from 'express';
import { admin } from '../lib/supabase.js';
import { uploadPdf, sha256Hex, recordAndSign } from '../lib/storage.js';
import { renderHtmlToPdf } from '../lib/renderer.js';
import { buildMonthlyHtml } from '../templates/monthly-summary.js';
import { assertCompanyAccess } from '../lib/auth.js';
import type {
  AuthedRequest, PickupEventRow, CompanyRow,
  BranchRow, DriverRow, VehicleRow,
} from '../types.js';

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export async function handleMonthly(req: AuthedRequest, res: Response): Promise<void> {
  const { branch_id, month } = req.body as { branch_id?: string; month?: string };

  if (!branch_id || !month) {
    res.status(400).json({ error: 'branch_id and month (YYYY-MM) are required' });
    return;
  }
  if (!MONTH_RE.test(month)) {
    res.status(400).json({ error: 'month must be in YYYY-MM format' });
    return;
  }

  // 1. Fetch the branch to determine company_id
  const { data: branch, error: branchErr } = await admin
    .from('branches')
    .select('id, company_id, name_ar, address_ar, city')
    .eq('id', branch_id)
    .single<BranchRow & { company_id: string }>();

  if (branchErr || !branch) {
    res.status(404).json({ error: 'Branch not found' });
    return;
  }

  // 2. Tenant authorization
  if (!assertCompanyAccess(req, branch.company_id, res)) return;

  // 3. Compute date range for the month
  const [year, mon] = month.split('-').map(Number) as [number, number];
  const from = new Date(Date.UTC(year, mon - 1, 1)).toISOString();
  // Last moment of the month
  const to = new Date(Date.UTC(year, mon, 1, 0, 0, 0, -1)).toISOString();

  // 4. Fetch all pickups for this branch in the month
  const { data: events, error: eventsErr } = await admin
    .from('pickup_events_latest')
    .select('*')
    .eq('branch_id', branch_id)
    .gte('created_at', from)
    .lte('created_at', to)
    .order('created_at', { ascending: true });

  if (eventsErr) {
    res.status(500).json({ error: 'Failed to fetch pickups' });
    return;
  }

  const typedEvents = (events ?? []) as PickupEventRow[];

  // 4b. Chain of custody (migration 018, trip-based): an event counts as
  //     custody-complete only when it's grouped into a trip (trip_id) AND
  //     that trip has a status='confirmed' disposal_confirmations row from
  //     the receiving facility.
  const tripIds = [...new Set(typedEvents.map((e) => e.trip_id).filter((id): id is string => id !== null))];
  let confirmedTripIds: string[] = [];
  if (tripIds.length > 0) {
    const { data: confirmations } = await admin
      .from('disposal_confirmations')
      .select('trip_id')
      .eq('status', 'confirmed')
      .in('trip_id', tripIds);
    confirmedTripIds = ((confirmations ?? []) as { trip_id: string }[]).map((c) => c.trip_id);
  }
  const custodyConfirmedIds = typedEvents
    .filter((e) => e.trip_id !== null && confirmedTripIds.includes(e.trip_id))
    .map((e) => e.id);

  // 5. Fetch company row
  const { data: company } = await admin
    .from('companies')
    .select('id, name_ar, commercial_registration, vat_number')
    .eq('id', branch.company_id)
    .single<CompanyRow>();

  // 6. Collect unique driver/vehicle IDs and check for expiry warnings
  const driverIds = [...new Set(typedEvents.map((e) => e.driver_id))];
  const vehicleIds = [...new Set(typedEvents.map((e) => e.vehicle_id))];
  const warningHorizon = new Date();
  warningHorizon.setDate(warningHorizon.getDate() + 30);
  const horizonStr = warningHorizon.toISOString().substring(0, 10);

  const [driverRes, vehicleRes] = await Promise.all([
    driverIds.length > 0
      ? admin.from('drivers').select('id, name_ar, license_expiry').in('id', driverIds)
      : { data: [] as DriverRow[], error: null },
    vehicleIds.length > 0
      ? admin.from('vehicles').select('id, plate_number, ncwm_license_expiry').in('id', vehicleIds)
      : { data: [] as VehicleRow[], error: null },
  ]);

  const expiryWarnings: { type: 'driver' | 'vehicle'; name: string; expiryDate: string }[] = [];

  for (const d of (driverRes.data ?? []) as DriverRow[]) {
    if (d.license_expiry <= horizonStr) {
      expiryWarnings.push({ type: 'driver', name: d.name_ar, expiryDate: d.license_expiry });
    }
  }
  for (const v of (vehicleRes.data ?? []) as VehicleRow[]) {
    if (v.ncwm_license_expiry <= horizonStr) {
      expiryWarnings.push({ type: 'vehicle', name: v.plate_number, expiryDate: v.ncwm_license_expiry });
    }
  }

  // 7. Render HTML → PDF
  const generatedAt = new Date().toISOString();
  const documentId = `${branch_id.substring(0, 8).toUpperCase()}-${month}`;

  const html = buildMonthlyHtml({
    company:        company!,
    branch:         branch,
    month,
    events:         typedEvents,
    expiryWarnings,
    custodyConfirmedIds,
    documentId,
    generatedAt,
  });

  const pdfBytes = await renderHtmlToPdf(html);
  const hash = sha256Hex(pdfBytes);

  // 8. Upload & record — versioned filename (content-hash suffix) so a
  //    re-generation never overwrites a previously recorded PDF.
  const filename = `${month}-${hash.slice(0, 12)}.pdf`;
  const pdfPath = await uploadPdf(branch.company_id, branch_id, filename, pdfBytes);

  // period_month stored as first-of-month date for the DB date column
  const periodMonth = `${month}-01`;

  const { signedUrl, inspectionPdfId } = await recordAndSign({
    companyId:     branch.company_id,
    branchId:      branch_id,
    pickupEventId: null,
    reportType:    'monthly_summary',
    periodMonth,
    pdfPath,
    sha256Hash:    hash,
    generatedBy:   req.userId,
  });

  res.json({
    signed_url:        signedUrl,
    pdf_path:          pdfPath,
    sha256_hash:       hash,
    inspection_pdf_id: inspectionPdfId,
  });
}
