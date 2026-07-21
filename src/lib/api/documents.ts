import { supabase } from '../supabase';
import { computeSha256 } from './storage';
import type {
  DocumentOwnerType, DocumentRow, RequiredDocument, OwnerDocumentStatus,
} from '../database.types';

const BUCKET = 'compliance-documents';

/** Required doc_types for one owner_type (global config, not tenant data). */
export async function listRequiredDocuments(ownerType: DocumentOwnerType): Promise<RequiredDocument[]> {
  const { data, error } = await supabase
    .from('required_documents')
    .select('*')
    .eq('owner_type', ownerType)
    .order('doc_type');
  if (error) throw error;
  return (data as RequiredDocument[]) ?? [];
}

/** Full document history for one owner (newest first) — RLS scopes visibility. */
export async function listDocumentsForOwner(
  ownerType: DocumentOwnerType,
  ownerId: string
): Promise<DocumentRow[]> {
  const { data, error } = await supabase
    .from('documents')
    .select('*')
    .eq('owner_type', ownerType)
    .eq('owner_id', ownerId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data as DocumentRow[]) ?? [];
}

/** Latest row per doc_type — what the checklist UI actually renders per required doc. */
export function latestPerDocType(docs: DocumentRow[]): Map<string, DocumentRow> {
  const latest = new Map<string, DocumentRow>();
  for (const d of docs) {
    if (!latest.has(d.doc_type)) latest.set(d.doc_type, d); // docs is already newest-first
  }
  return latest;
}

/**
 * Server-computed completion/activation status (migration 021's
 * owner_document_status RPC) — never computed client-side.
 */
export async function getOwnerDocumentStatus(
  ownerType: DocumentOwnerType,
  ownerId: string
): Promise<OwnerDocumentStatus> {
  const { data, error } = await supabase.rpc('owner_document_status', {
    p_owner_type: ownerType,
    p_owner_id: ownerId,
  });
  if (error) throw error;
  // PostgREST returns a single-row RPC result as an array of one row.
  const row = (Array.isArray(data) ? data[0] : data) as OwnerDocumentStatus | undefined;
  if (!row) throw new Error('owner_document_status returned no row');
  return row;
}

/**
 * Upload a compliance document: hash + store the file under
 * {owner_type}/{owner_id}/{doc_type}-{timestamp}.{ext}, then append the
 * documents row. Always lands as status='pending' — status/reviewed_*
 * fields are server-forced regardless of what we send (see
 * documents_before_insert, migration 021).
 */
export async function uploadDocument(
  ownerType: DocumentOwnerType,
  ownerId: string,
  docType: string,
  file: File,
  opts: { issueDate?: string; expiryDate?: string } = {}
): Promise<DocumentRow> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const sha256 = await computeSha256(bytes);
  const ext = file.name.split('.').pop() ?? 'jpg';
  const path = `${ownerType}/${ownerId}/${docType}-${Date.now()}.${ext}`;

  const { error: uploadErr } = await supabase.storage
    .from(BUCKET)
    .upload(path, bytes, { upsert: false, contentType: file.type || 'application/octet-stream' });
  if (uploadErr) throw uploadErr;

  const { data, error } = await supabase
    .from('documents')
    .insert({
      owner_type: ownerType,
      owner_id: ownerId,
      doc_type: docType,
      file_path: path,
      file_sha256: sha256,
      issue_date: opts.issueDate,
      expiry_date: opts.expiryDate,
    })
    .select()
    .single<DocumentRow>();
  if (error) throw error;
  return data;
}

export async function getDocumentSignedUrl(path: string, expiresIn = 3600): Promise<string> {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, expiresIn);
  if (error) throw error;
  return data.signedUrl;
}

// ─── Document Reviewer queue ────────────────────────────────────────────────

/** Every document awaiting review — RLS (can_review_documents()) scopes this
 *  to document_reviewer/admin only; anyone else gets an empty result. */
export async function listPendingDocuments(): Promise<DocumentRow[]> {
  const { data, error } = await supabase
    .from('documents')
    .select('*')
    .eq('status', 'pending')
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data as DocumentRow[]) ?? [];
}

/** Resolve a human-readable label for a document's owner (reviewer queue display). */
export async function describeDocumentOwner(ownerType: DocumentOwnerType, ownerId: string): Promise<string> {
  const fallback = ownerId.slice(0, 8);
  switch (ownerType) {
    case 'company': {
      const { data } = await supabase.from('companies').select('name_ar').eq('id', ownerId).maybeSingle<{ name_ar: string }>();
      return data?.name_ar ?? fallback;
    }
    case 'branch': {
      const { data } = await supabase.from('branches').select('name_ar').eq('id', ownerId).maybeSingle<{ name_ar: string }>();
      return data?.name_ar ?? fallback;
    }
    case 'transport_company': {
      const { data } = await supabase.from('transport_companies').select('name_ar').eq('id', ownerId).maybeSingle<{ name_ar: string }>();
      return data?.name_ar ?? fallback;
    }
    case 'driver': {
      const { data } = await supabase.from('drivers').select('name_ar').eq('id', ownerId).maybeSingle<{ name_ar: string }>();
      return data?.name_ar ?? fallback;
    }
    case 'vehicle': {
      const { data } = await supabase.from('vehicles').select('plate_number').eq('id', ownerId).maybeSingle<{ plate_number: string }>();
      return data?.plate_number ?? fallback;
    }
    case 'facility': {
      const { data } = await supabase.from('facilities').select('name_ar').eq('id', ownerId).maybeSingle<{ name_ar: string }>();
      return data?.name_ar ?? fallback;
    }
    default:
      return fallback;
  }
}

/**
 * Verify or reject a pending document. RLS (documents_update) + the
 * documents_before_update trigger enforce this is a document_reviewer/admin,
 * never the uploader, and that reject requires a non-empty reason —
 * enforced server-side either way, this is just the client call.
 */
export async function reviewDocument(
  id: string,
  decision: 'verified' | 'rejected',
  rejectReason?: string
): Promise<DocumentRow> {
  const { data, error } = await supabase
    .from('documents')
    .update({ status: decision, reject_reason: decision === 'rejected' ? rejectReason : undefined })
    .eq('id', id)
    .select()
    .single<DocumentRow>();
  if (error) throw error;
  return data;
}
