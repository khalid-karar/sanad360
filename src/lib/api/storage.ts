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

/** Result of an evidence upload: the storage path plus the SHA-256 of the bytes. */
export interface EvidenceUploadResult {
  path: string;
  sha256: string;
}

/**
 * Compute the lowercase hex SHA-256 of a byte array using the Web Crypto API
 * (SubtleCrypto — available in browsers and the Node 18+ / Vitest test env).
 */
export async function computeSha256(bytes: Uint8Array): Promise<string> {
  // Copy into a fresh ArrayBuffer-backed view so the digest input is a plain
  // BufferSource (and never a SharedArrayBuffer-backed view).
  const buf = new Uint8Array(bytes.byteLength);
  buf.set(bytes);
  const hashBuffer = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Generic evidence uploader. Computes the SHA-256 of the file bytes BEFORE
 * uploading and returns both the storage path and the digest. The digest is
 * persisted alongside the pickup event so any later mutation of the stored
 * object (which the storage RLS already forbids) would be detectable.
 *
 * Append-only by construction: upsert is always false, so an upload to an
 * existing path fails rather than overwriting.
 */
export async function uploadEvidenceFile(
  bucket: 'pickup-photos' | 'pickup-signatures' | 'pickup-receipts' | 'disposal-tickets',
  path: string,
  file: File | Uint8Array | Blob,
  contentType?: string
): Promise<EvidenceUploadResult> {
  let bytes: Uint8Array;
  if (file instanceof Uint8Array) {
    bytes = file;
  } else {
    bytes = new Uint8Array(await (file as Blob).arrayBuffer());
  }

  const sha256 = await computeSha256(bytes);

  const { error } = await supabase.storage
    .from(bucket)
    .upload(path, bytes, { upsert: false, contentType });

  if (error) throw error;
  return { path, sha256 };
}

/** Upload a signature (base64 data URL) to Supabase Storage. Returns path + sha256. */
export async function uploadSignature(
  companyId: string,
  branchId: string,
  pickupEventId: string,
  base64DataUrl: string
): Promise<EvidenceUploadResult> {
  // Convert base64 data URL to bytes
  const response = await fetch(base64DataUrl);
  const blob = await response.blob();
  const path = buildPath(companyId, branchId, pickupEventId, 'signature', 'png');
  return uploadEvidenceFile(BUCKETS.SIGNATURES, path, blob, 'image/png');
}

/** Upload a photo File to Supabase Storage. Returns path + sha256. */
export async function uploadPhoto(
  companyId: string,
  branchId: string,
  pickupEventId: string,
  file: File
): Promise<EvidenceUploadResult> {
  const ext = file.name.split('.').pop() ?? 'jpg';
  const path = buildPath(companyId, branchId, pickupEventId, 'photo', ext);
  return uploadEvidenceFile(BUCKETS.PHOTOS, path, file, file.type || 'image/jpeg');
}

/** Upload a receipt File to Supabase Storage. Returns path + sha256. */
export async function uploadReceipt(
  companyId: string,
  branchId: string,
  pickupEventId: string,
  file: File
): Promise<EvidenceUploadResult> {
  const ext = file.name.split('.').pop() ?? 'pdf';
  const path = buildPath(companyId, branchId, pickupEventId, 'receipt', ext);
  return uploadEvidenceFile(BUCKETS.RECEIPTS, path, file, file.type || 'application/pdf');
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
