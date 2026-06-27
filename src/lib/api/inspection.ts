import { supabase } from '../supabase';
import type { InspectionPdf } from '../database.types';

const PDF_SERVICE_URL = (import.meta.env.VITE_PDF_SERVICE_URL as string | undefined)
  ?? 'http://localhost:3001';

async function getJwt(): Promise<string> {
  const { data: { session }, error } = await supabase.auth.getSession();
  if (error || !session) throw new Error('Not authenticated');
  return session.access_token;
}

async function callService<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const jwt = await getJwt();
  const res = await fetch(`${PDF_SERVICE_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${jwt}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    let message = `PDF service error ${res.status}`;
    try {
      const json = await res.json() as { error?: string };
      if (json.error) message = json.error;
    } catch { /* ignore parse error */ }
    throw new Error(message);
  }

  return res.json() as Promise<T>;
}

export interface GenerateResult {
  signed_url: string;
  pdf_path: string;
  sha256_hash: string;
  inspection_pdf_id: string;
}

/** Generate (or re-generate) the single-pickup inspection PDF. Returns a signed URL. */
export async function generateSinglePickupPdf(pickupEventId: string): Promise<GenerateResult> {
  return callService<GenerateResult>('/generate/single-pickup', {
    pickup_event_id: pickupEventId,
  });
}

/** Generate (or re-generate) the monthly summary PDF for a branch+month. */
export async function generateMonthlyPdf(
  branchId: string,
  month: string // "YYYY-MM"
): Promise<GenerateResult> {
  return callService<GenerateResult>('/generate/monthly-summary', {
    branch_id: branchId,
    month,
  });
}

/** List previously generated inspection PDFs for the caller's company. */
export async function listInspectionPdfs(opts: {
  branchId?: string;
  reportType?: 'single_pickup' | 'monthly_summary';
  limit?: number;
} = {}): Promise<InspectionPdf[]> {
  let query = supabase
    .from('inspection_pdfs')
    .select('*')
    .order('created_at', { ascending: false });

  if (opts.branchId)    query = query.eq('branch_id', opts.branchId);
  if (opts.reportType)  query = query.eq('report_type', opts.reportType);
  if (opts.limit)       query = query.limit(opts.limit);

  const { data, error } = await query;
  if (error) throw error;
  return (data as InspectionPdf[]) ?? [];
}

/** Get a fresh signed URL for an already-generated PDF (1-hour expiry). */
export async function refreshPdfUrl(pdfPath: string): Promise<string> {
  const { data, error } = await supabase.storage
    .from('inspection-pdfs')
    .createSignedUrl(pdfPath, 3600);
  if (error) throw error;
  return data.signedUrl;
}
