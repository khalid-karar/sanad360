import type { Request, Response } from 'express';
import { admin } from '../lib/supabase.js';

interface VerifyBody {
  token?: string;
}

interface VerifyRpcRow {
  success: boolean;
  application_id: string | null;
  applicant_user_id: string | null;
}

const GENERIC_FAILURE = { error: 'This verification link is invalid or has expired.' };

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * POST /public/verify-email
 *
 * Body carries the raw token (not a GET query string — avoids the token
 * riding along in proxy/access logs). Calls verify_application_email()
 * (service_role only, migration 036) then flips the auth user's
 * email_confirm so the applicant can actually log in — that second step is
 * a GoTrue admin-API call, unreachable from SQL, which is why this whole
 * flow can't live purely in the DB function.
 *
 * The DB transition (pending_email_verification -> pending_documents) is
 * committed and irreversible once verify_application_email() succeeds.
 * updateUserById is retried a few times on transient failure so a flaky
 * network doesn't leave "verified in DB but still can't log in" — if every
 * retry still fails, we don't turn that into a user-facing error (the
 * verification itself genuinely succeeded), we log it as a CRITICAL
 * server-side alert for manual repair (an operator can call
 * admin.auth.admin.updateUserById directly) and tell the applicant they're
 * verified.
 */
export async function handlePublicVerifyEmail(req: Request, res: Response): Promise<void> {
  const body = req.body as VerifyBody;
  const token = body.token;
  if (!token || typeof token !== 'string' || !token.trim()) {
    res.status(400).json(GENERIC_FAILURE);
    return;
  }

  const { data, error } = await admin.rpc('verify_application_email', { p_token: token });
  if (error) {
    console.error('[public-verify-email] verify_application_email RPC error:', error.message);
    res.status(400).json(GENERIC_FAILURE);
    return;
  }

  const row = (Array.isArray(data) ? data[0] : data) as VerifyRpcRow | undefined;
  if (!row?.success || !row.applicant_user_id) {
    res.status(400).json(GENERIC_FAILURE);
    return;
  }

  let confirmed = false;
  let lastErrMessage: string | undefined;
  for (let attempt = 0; attempt < 3 && !confirmed; attempt++) {
    if (attempt > 0) await sleep(attempt * 250);
    const { error: updateErr } = await admin.auth.admin.updateUserById(row.applicant_user_id, {
      email_confirm: true,
    });
    if (!updateErr) {
      confirmed = true;
    } else {
      lastErrMessage = updateErr.message;
    }
  }

  if (!confirmed) {
    // CRITICAL: DB says verified (pending_documents), but the applicant
    // cannot yet log in. Surfaced loudly for manual repair — never silent.
    console.error(
      '[public-verify-email] CRITICAL: verify_application_email succeeded but updateUserById failed after retries',
      { applicationId: row.application_id, applicantUserId: row.applicant_user_id, lastErrMessage }
    );
  }

  res.status(200).json({
    verified: true,
    message: confirmed
      ? 'Your email has been verified. You can now log in.'
      : 'Your email has been verified. If you have trouble logging in shortly, please contact support.',
  });
}
