import { createHash } from 'crypto';
import { admin } from './supabase.js';

const PDF_BUCKET = 'inspection-pdfs';

// Download an evidence file from Supabase Storage and return as base64 data URL.
// Returns null if path is null (evidence not captured).
export async function evidenceToDataUrl(
  bucket: string,
  path: string | null
): Promise<string | null> {
  if (!path) return null;

  const { data, error } = await admin.storage.from(bucket).download(path);
  if (error || !data) return null;

  const arrayBuffer = await data.arrayBuffer();
  const base64 = Buffer.from(arrayBuffer).toString('base64');
  const mime = data.type || 'image/jpeg';
  return `data:${mime};base64,${base64}`;
}

// Upload the generated PDF bytes to the inspection-pdfs bucket.
// Returns the storage path.
export async function uploadPdf(
  companyId: string,
  branchId: string,
  filename: string, // pickup_event_id.pdf or YYYY-MM.pdf
  pdfBytes: Buffer
): Promise<string> {
  const path = `${companyId}/${branchId}/${filename}`;

  const { error } = await admin.storage
    .from(PDF_BUCKET)
    .upload(path, pdfBytes, {
      contentType: 'application/pdf',
      upsert: true, // allow re-generation (overwrites previous file)
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
