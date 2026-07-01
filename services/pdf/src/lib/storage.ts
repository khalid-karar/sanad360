import { createHash } from 'crypto';
import { admin } from './supabase.js';

const PDF_BUCKET = 'inspection-pdfs';

// A downloaded evidence file: base64 data URL for embedding in the PDF, plus
// the SHA-256 of the actual downloaded bytes so the route can re-verify the
// client-supplied hash server-side.
export interface EvidenceFetch {
  dataUrl: string;
  sha256: string;
}

// Download an evidence file from Supabase Storage. Returns the base64 data URL
// (for Playwright embedding) together with a server-computed SHA-256 of the
// downloaded bytes. Returns null if path is null (evidence not captured) or
// the object cannot be downloaded.
export async function fetchEvidence(
  bucket: string,
  path: string | null
): Promise<EvidenceFetch | null> {
  if (!path) return null;

  const { data, error } = await admin.storage.from(bucket).download(path);
  if (error || !data) return null;

  const arrayBuffer = await data.arrayBuffer();
  const bytes = Buffer.from(arrayBuffer);
  const mime = data.type || 'image/jpeg';
  return {
    dataUrl: `data:${mime};base64,${bytes.toString('base64')}`,
    sha256: sha256Hex(bytes),
  };
}

// Upload the generated PDF bytes to the inspection-pdfs bucket.
// Returns the storage path.
//
// upsert is deliberately FALSE: every generation writes a NEW object (callers
// version the filename with a content-hash prefix), so the bytes an
// inspection_pdfs row points at can never change after the row is written —
// the stored sha256_hash stays verifiable forever. The previous upsert:true
// overwrote the object on re-generation, silently invalidating the hash of
// every earlier inspection_pdfs row for the same path.
export async function uploadPdf(
  companyId: string,
  branchId: string,
  filename: string, // e.g. {event_id}-r{rev}-{hash12}.pdf or {YYYY-MM}-{hash12}.pdf
  pdfBytes: Buffer
): Promise<string> {
  const path = `${companyId}/${branchId}/${filename}`;

  const { error } = await admin.storage
    .from(PDF_BUCKET)
    .upload(path, pdfBytes, {
      contentType: 'application/pdf',
      upsert: false,
    });

  if (error) throw new Error(`Storage upload failed: ${error.message}`);
  return path;
}

// Compute SHA-256 hex digest of bytes.
export function sha256Hex(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

// Insert an inspection_pdfs row and return the signed URL.
export async function recordAndSign(opts: {
  companyId: string;
  branchId: string | null;
  pickupEventId: string | null;
  reportType: 'single_pickup' | 'monthly_summary';
  periodMonth: string | null; // ISO date "YYYY-MM-01" for monthly; null for single
  pdfPath: string;
  sha256Hash: string;
  generatedBy: string;
}): Promise<{ signedUrl: string; inspectionPdfId: string }> {
  const { data, error } = await admin
    .from('inspection_pdfs')
    .insert({
      company_id:       opts.companyId,
      branch_id:        opts.branchId,
      pickup_event_id:  opts.pickupEventId,
      report_type:      opts.reportType,
      period_month:     opts.periodMonth,
      pdf_path:         opts.pdfPath,
      sha256_hash:      opts.sha256Hash,
      generated_by:     opts.generatedBy,
    })
    .select('id')
    .single<{ id: string }>();

  if (error) throw new Error(`DB insert failed: ${error.message}`);

  // Generate a 1-hour signed URL
  const { data: signed, error: signError } = await admin.storage
    .from(PDF_BUCKET)
    .createSignedUrl(opts.pdfPath, 3600);

  if (signError || !signed) {
    throw new Error(`Signed URL failed: ${signError?.message}`);
  }

  return { signedUrl: signed.signedUrl, inspectionPdfId: data.id };
}
