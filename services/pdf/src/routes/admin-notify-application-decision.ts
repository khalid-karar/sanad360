import type { Response } from 'express';
import { admin } from '../lib/supabase.js';
import { send } from '../lib/email.js';
import type { AuthedRequest } from '../types.js';

interface NotifyBody {
  application_id?: string;
  locale?: 'ar' | 'en';
}

interface PendingApplicationRow {
  id: string;
  status: string;
  contact_email: string;
  name_ar: string;
  name_en: string | null;
  reject_reason: string | null;
}

const REVIEWER_ROLES = ['document_reviewer', 'system_admin', 'admin', 'super_admin'];

/**
 * POST /admin/notify-application-decision
 *
 * Called by the frontend immediately AFTER review_pending_application()
 * (the RPC — called directly, authenticated, from the frontend; unchanged
 * by this migration) has already committed the approve/reject decision.
 * This endpoint's only job is the email side, which the RPC cannot do
 * itself (SQL can't call SES). It re-reads the application row itself
 * rather than trusting client-supplied decision/reason — the client only
 * supplies WHICH application, never WHAT happened to it.
 *
 * A failed send does NOT roll back the RPC's decision — that already
 * committed (status flip, membership grant/revoke, audit log) and is
 * correct regardless of whether the notification email goes out. This
 * endpoint is safely re-callable (idempotent re-read + re-send) so the
 * admin UI can offer a "resend notification" retry on failure.
 */
export async function handleNotifyApplicationDecision(req: AuthedRequest, res: Response): Promise<void> {
  if (!REVIEWER_ROLES.includes(req.memberRole)) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }

  const body = req.body as NotifyBody;
  if (!body.application_id || typeof body.application_id !== 'string') {
    res.status(400).json({ error: 'application_id is required' });
    return;
  }
  const locale: 'ar' | 'en' = body.locale === 'en' ? 'en' : 'ar';

  const { data: application, error } = await admin
    .from('pending_applications')
    .select('id, status, contact_email, name_ar, name_en, reject_reason')
    .eq('id', body.application_id)
    .maybeSingle<PendingApplicationRow>();

  if (error || !application) {
    res.status(404).json({ error: 'Application not found' });
    return;
  }

  if (application.status !== 'approved' && application.status !== 'rejected') {
    res.status(400).json({ error: 'Application is not in a decided state' });
    return;
  }

  const name = application.name_en || application.name_ar;

  try {
    if (application.status === 'approved') {
      await send(application.contact_email, 'approved', locale, { name });
    } else {
      await send(application.contact_email, 'rejected', locale, {
        name,
        reason: application.reject_reason ?? '',
      });
    }
  } catch (e) {
    console.error(
      '[notify-application-decision] send failed:',
      e instanceof Error ? e.message : String(e),
      { applicationId: application.id }
    );
    res.status(200).json({ sent: false, status: application.status });
    return;
  }

  res.status(200).json({ sent: true, status: application.status });
}
