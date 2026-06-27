import type { Response } from 'express';
import { admin } from '../lib/supabase.js';
import { evidenceToDataUrl, uploadPdf, sha256Hex, recordAndSign } from '../lib/storage.js';
import { renderHtmlToPdf } from '../lib/renderer.js';
import { buildSinglePickupHtml } from '../templates/single-pickup.js';
import { assertCompanyAccess } from '../lib/auth.js';
import type { AuthedRequest, PickupEventRow, CompanyRow, BranchRow, TransportCompanyRow, DriverRow, VehicleRow } from '../types.js';

export async function handleSinglePickup(req: AuthedRequest, res: Response): Promise<void> {
  const { pickup_event_id } = req.body as { pickup_event_id?: string };

  if (!pickup_event_id) {
    res.status(400).json({ error: 'pickup_event_id is required' });
    return;
  }

  // 1. Fetch the pickup event (latest revision, RLS bypassed — we enforce tenant check below)
  const { data: event, error: eventErr } = await admin
    .from('pickup_events_latest')
    .select('*')
    .eq('id', pickup_event_id)
    .single<PickupEventRow>();

  if (eventErr || !event) {
    res.status(404).json({ error: 'Pickup event not found' });
    return;
  }

  // 2. Tenant authorization: caller must belong to the same company
  if (!assertCompanyAccess(req, event.company_id, res)) return;

  // 3. Fetch related entities in parallel
  const [companyRes, branchRes, transportRes, driverRes, vehicleRes] = await Promise.all([
    admin.from('companies').select('id, name_ar, commercial_registration, vat_number').eq('id', event.company_id).single<CompanyRow>(),
    admin.from('branches').select('id, name_ar, address_ar, city').eq('id', event.branch_id).single<BranchRow>(),
    admin.from('transport_companies').select('id, name_ar, ncwm_license_number, ncwm_license_expiry').eq('id', event.transport_company_id).single<TransportCompanyRow>(),
    admin.from('drivers').select('id, name_ar, license_number, license_expiry').eq('id', event.driver_id).single<DriverRow>(),
    admin.from('vehicles').select('id, plate_number, type, ncwm_license_number, ncwm_license_expiry').eq('id', event.vehicle_id).single<VehicleRow>(),
  ]);

  if (companyRes.error || branchRes.error || transportRes.error || driverRes.error || vehicleRes.error) {
    res.status(500).json({ error: 'Failed to fetch related entities' });
    return;
  }

  // 4. Fetch evidence files as base64 data URLs so Playwright doesn't need to hit Storage URLs
  const [photoDataUrl, receiptDataUrl, sigDataUrl] = await Promise.all([
    evidenceToDataUrl('pickup-photos',    event.photo_path),
    evidenceToDataUrl('pickup-receipts',  event.receipt_path),
    evidenceToDataUrl('pickup-signatures', event.signature_path),
  ]);

  // 5. Render HTML → PDF
  const generatedAt = new Date().toISOString();
  const documentId = event.id.substring(0, 8).toUpperCase();

  const templateArgs = {
    event,
    company:   companyRes.data!,
    branch:    branchRes.data!,
    transport: transportRes.data!,
    driver:    driverRes.data!,
    vehicle:   vehicleRes.data!,
    evidence:  { photo: photoDataUrl, receipt: receiptDataUrl, signature: sigDataUrl },
    documentId,
    generatedAt,
  };

  // Two-pass render so the PDF can display its own content hash:
  //   Pass 1 → canonical (un-stamped) bytes → contentHash (shown in the report).
  //   Pass 2 → same document with contentHash stamped into the hashes table.
  // The stored/returned hash is the SHA-256 of the FINAL (pass-2) bytes, so a
  // re-download + re-hash always matches (see inspection-pdf.test).
  const canonicalBytes = await renderHtmlToPdf(buildSinglePickupHtml(templateArgs));
  const contentHash = sha256Hex(canonicalBytes);

  const pdfBytes = await renderHtmlToPdf(
    buildSinglePickupHtml({ ...templateArgs, pdfSha256: contentHash })
  );

  // 6. SHA-256 of the final PDF bytes (what gets uploaded + returned)
  const hash = sha256Hex(pdfBytes);

  // 7. Upload to Storage
  const pdfPath = await uploadPdf(event.company_id, event.branch_id, `${event.id}.pdf`, pdfBytes);

  // 8. Insert DB row + get signed URL
  const { signedUrl, inspectionPdfId } = await recordAndSign({
    companyId:      event.company_id,
    branchId:       event.branch_id,
    pickupEventId:  event.id,
    reportType:     'single_pickup',
    periodMonth:    null,
    pdfPath,
    sha256Hash:     hash,
    generatedBy:    req.userId,
  });

  res.json({
    signed_url:        signedUrl,
    pdf_path:          pdfPath,
    sha256_hash:       hash,
    inspection_pdf_id: inspectionPdfId,
  });
}
