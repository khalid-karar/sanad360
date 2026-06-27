import { supabase } from '../supabase';

// Storage bucket names
export const BUCKETS = {
  PHOTOS: 'pickup-photos',
  RECEIPTS: 'pickup-receipts',
  SIGNATURES: 'pickup-signatures',
  PDFS: 'inspection-pdfs',
} as const;

/**
 * Builds the canonical object path for evidence files.
 * Pattern: {company_id}/{branch_id}/{pickup_event_id}/{type}.{ext}
 */
function buildPath(
  companyId: string,
  branchId: string,
  pickupEventId: string,
  type: string,
  ext: string
): string {
  return `${companyId}/${branchId}/${pickupEventId}/${type}.${ext}`;
}

/** Upload a signature (base64 data URL) to Supabase Storage. Returns the storage path. */
export async function uploadSignature(
  companyId: string,
  branchId: string,
  pickupEventId: string,
  base64DataUrl: string
): Promise<string> {
  // Convert base64 data URL to Blob
  const response = await fetch(base64DataUrl);
  const blob = await response.blob();
  const path = buildPath(companyId, branchId, pickupEventId, 'signature', 'png');

  const { error } = await supabase.storage
    .from(BUCKETS.SIGNATURES)
    .upload(path, blob, {
      contentType: 'image/png',
      upsert: false,
    });

  if (error) throw error;
  return path;
}

/** Upload a photo File to Supabase Storage. Returns the storage path. */
export async function uploadPhoto(
  companyId: string,
  branchId: string,
  pickupEventId: string,
  file: File
): Promise<string> {
  const ext = file.name.split('.').pop() ?? 'jpg';
  const path = buildPath(companyId, branchId, pickupEventId, 'photo', ext);

  const { error } = await supabase.storage
    .from(BUCKETS.PHOTOS)
    .upload(path, file, {
      contentType: file.type || 'image/jpeg',
      upsert: false,
    });

  if (error) throw error;
  return path;
}

/** Upload a receipt File to Supabase Storage. Returns the storage path. */
export async function uploadReceipt(
  companyId: string,
  branchId: string,
  pickupEventId: string,
  file: File
): Promise<string> {
  const ext = file.name.split('.').pop() ?? 'pdf';
  const path = buildPath(companyId, branchId, pickupEventId, 'receipt', ext);

  const { error } = await supabase.storage
    .from(BUCKETS.RECEIPTS)
    .upload(path, file, {
      contentType: file.type || 'application/pdf',
      upsert: false,
    });

  if (error) throw error;
  return path;
}

/**
 * Get a short-lived signed URL for viewing a private file.
 * Default expiry: 1 hour (3600 s).
 */
export async function getSignedUrl(
  bucket: string,
  path: string,
  expiresIn = 3600
): Promise<string> {
  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(path, expiresIn);

  if (error) throw error;
  return data.signedUrl;
}

/** Download a file as a Blob (for PDF generation in Phase 2). */
export async function downloadFile(bucket: string, path: string): Promise<Blob> {
  const { data, error } = await supabase.storage.from(bucket).download(path);
  if (error) throw error;
  return data;
}
