import type { Response } from 'express';
import { admin } from '../lib/supabase.js';
import type { AuthedRequest } from '../types.js';

interface RevokeMembershipBody {
  membership_id?: string;
  reason?: string;
}

/**
 * POST /company/revoke-membership
 *
 * Soft-revokes a membership (migration 032: revoked_at/revoked_by/
 * revoke_reason — never DELETE, the row stays as an audit trail). Runs
 * behind authMiddleware; additionally requires the caller to be an
 * owner/manager of the SAME company the target membership belongs to.
 *
 * memberships is deliberately SELECT-only for authenticated (see
 * invite-driver.ts) — this write goes through the service-role client here,
 * same pattern as every other membership mutation in this codebase.
 */
export async function handleRevokeMembership(req: AuthedRequest, res: Response): Promise<void> {
  if (!req.companyId || !['owner', 'manager'].includes(req.memberRole)) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }

  const body = req.body as RevokeMembershipBody;
  if (!body.membership_id || !body.reason || !body.reason.trim()) {
    res.status(400).json({ error: 'membership_id and reason are required' });
    return;
  }

  const { data: target, error: targetErr } = await admin
    .from('memberships')
    .select('id, company_id, role, revoked_at')
    .eq('id', body.membership_id)
    .maybeSingle<{ id: string; company_id: string | null; role: string; revoked_at: string | null }>();

  if (targetErr || !target) {
    res.status(404).json({ error: 'Membership not found' });
    return;
  }
  if (target.company_id !== req.companyId) {
    res.status(403).json({ error: 'Access denied: tenant mismatch' });
    return;
  }
  if (target.revoked_at) {
    res.status(409).json({ error: 'Membership already revoked' });
    return;
  }
  // Maya-side roles have no place on a company-scoped membership at all
  // (one_tenant CHECK, migration 025) — this can't actually occur, but
  // rejecting it explicitly is cheap insurance against ever widening this
  // endpoint's reach by accident.
  if (['admin', 'super_admin', 'system_admin', 'support_agent', 'billing_accountant', 'document_reviewer', 'gov_viewer'].includes(target.role)) {
    res.status(403).json({ error: 'Cannot revoke a Maya-side role through this endpoint' });
    return;
  }

  const { error: updateErr } = await admin
    .from('memberships')
    .update({
      revoked_at: new Date().toISOString(),
      revoked_by: req.userId,
      revoke_reason: body.reason.trim(),
    })
    .eq('id', target.id);

  if (updateErr) {
    res.status(400).json({ error: `memberships.update: ${updateErr.message}` });
    return;
  }

  await admin.from('audit_log').insert({
    user_id: req.userId,
    tenant_id: req.companyId,
    tenant_type: 'company',
    action: 'revoke_membership',
    entity_type: 'memberships',
    entity_id: target.id,
  });

  res.status(200).json({ membership_id: target.id, revoked: true });
}
