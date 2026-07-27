import { supabase } from '../supabase';
import { PDF_SERVICE_URL } from '../pdfServiceUrl';
import type { PendingApplication } from '../database.types';

export interface SignupPayload {
  tenant_type: 'company' | 'transport_company';
  name_ar: string;
  name_en?: string;
  commercial_registration: string;
  vat_number?: string;
  industry_code?: string;
  contact_email: string;
  contact_phone?: string;
  password: string;
  locale?: 'ar' | 'en';
}

/**
 * POST /public/signup — unauthenticated, info-only. The caller (SignupPage)
 * treats EVERY completed HTTP response (whatever the status code) the same
 * way: an ambiguous "if this is new to us, check your email" confirmation —
 * mirroring the server's own no-enumeration posture (services/pdf's
 * public-signup route folds every existence conflict into an identical 202).
 * Only a network-level failure (no response at all) is treated differently
 * here, since "couldn't reach the server" reveals nothing about any
 * particular email/CR.
 */
export async function signupApplicant(payload: SignupPayload): Promise<void> {
  await fetch(`${PDF_SERVICE_URL}/public/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  // Deliberately not branching on res.ok / res.status — see comment above.
}

/**
 * POST /public/verify-email — unauthenticated. Throws with the server's own
 * generic failure message on any non-success outcome (expired/invalid/
 * already-used tokens are indistinguishable by design); the raw token never
 * appears in any log here, only in the request body.
 */
export async function verifyEmailToken(token: string): Promise<{ message: string }> {
  const res = await fetch(`${PDF_SERVICE_URL}/public/verify-email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  });
  const json = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
  if (!res.ok) {
    throw new Error(json.error ?? 'This verification link is invalid or has expired.');
  }
  return { message: json.message ?? 'Your email has been verified.' };
}

// Must match migration 035's column-level GRANT to `authenticated` exactly
// (and PendingApplication's own field list, database.types.ts) —
// email_verification_token_hash/email_verification_expires_at are
// deliberately NOT granted (service_role only). `select('*')` requests
// every column, including those two, and Postgres rejects the WHOLE query
// with 42501 rather than silently omitting the disallowed ones — found via
// CP8 Slice F's browser E2E test hitting a real 403 on this exact call.
// One literal (not concatenated) so postgrest-js can statically parse the
// column list into a typed row instead of falling back to GenericStringError.
const PENDING_APPLICATION_COLUMNS = 'id, applicant_user_id, tenant_type, name_ar, name_en, commercial_registration, vat_number, industry_code, contact_email, contact_phone, status, email_verified_at, reviewed_by, reviewed_at, reject_reason, resulting_company_id, resulting_transport_company_id, created_at' as const;

/** The signed-in applicant's own application — RLS scopes this to their own row. */
export async function fetchMyApplication(userId: string): Promise<PendingApplication | null> {
  const { data, error } = await supabase
    .from('pending_applications')
    .select(PENDING_APPLICATION_COLUMNS)
    .eq('applicant_user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle<PendingApplication>();
  if (error) throw error;
  return data;
}

/**
 * submit_application_for_review() RPC (migration 041) — the ONLY path
 * pending_documents -> pending_review. Server re-validates document
 * completeness against the application's OWN tenant_type; a client-side
 * completeness check (ApplicationDocumentChecklist) should normally prevent
 * this from ever being called incomplete, but the server error
 * (INCOMPLETE_DOCUMENTS: ...) is the authority either way.
 */
export async function submitApplicationForReview(applicationId: string): Promise<void> {
  const { error } = await supabase.rpc('submit_application_for_review', {
    p_application_id: applicationId,
  });
  if (error) throw error;
}

/** Review queue: every application awaiting a decision. RLS (can_review_documents()
 *  OR is_system_admin() OR is_full_admin()) scopes this to reviewers/admins only. */
export async function listApplicationsPendingReview(): Promise<PendingApplication[]> {
  const { data, error } = await supabase
    .from('pending_applications')
    .select(PENDING_APPLICATION_COLUMNS)
    .eq('status', 'pending_review')
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data as PendingApplication[]) ?? [];
}

/**
 * review_pending_application() RPC (migration 035) — the ONLY path
 * pending_review -> approved/rejected. Caller must be a real reviewer role
 * and not the applicant themself (enforced server-side).
 */
export async function reviewApplication(
  applicationId: string,
  decision: 'approved' | 'rejected',
  rejectReason?: string
): Promise<void> {
  const { error } = await supabase.rpc('review_pending_application', {
    p_application_id: applicationId,
    p_decision: decision,
    p_reject_reason: decision === 'rejected' ? (rejectReason ?? null) : null,
  });
  if (error) throw error;
}

/**
 * POST /admin/notify-application-decision — called AFTER reviewApplication()
 * has already committed. Re-reads the row server-side; never trusts a
 * client-supplied decision. A failed send does not mean the decision
 * failed — callers should show a non-blocking "resend" affordance, not
 * treat this as the operation failing.
 */
export async function notifyApplicationDecision(
  applicationId: string
): Promise<{ sent: boolean; status: string }> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');

  const res = await fetch(`${PDF_SERVICE_URL}/admin/notify-application-decision`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ application_id: applicationId }),
  });
  if (!res.ok) {
    let message = `Notify failed (${res.status})`;
    try {
      const json = (await res.json()) as { error?: string };
      if (json.error) message = json.error;
    } catch { /* ignore parse error */ }
    throw new Error(message);
  }
  return res.json() as Promise<{ sent: boolean; status: string }>;
}
