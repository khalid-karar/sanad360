import type { Response } from 'express';
import { admin } from '../lib/supabase.js';
import { assertCompanyAccess } from '../lib/auth.js';
import { issueBranchQrToken } from '../lib/branchQr.js';
import type { AuthedRequest } from '../types.js';

/**
 * POST /branches/:branchId/qr
 *
 * Issues a short-TTL, HMAC-signed QR token for the branch's own device to
 * display and rotate (migration 022/Part B — branches.qr_token stops being a
 * value any client ever sees; only this endpoint's signed, 90-second-TTL
 * derivative ever leaves the server). Restricted to owner/manager of the
 * branch's own company — this is the same company-side page
 * (src/pages/BranchesPage.tsx, AppShell role="company") that already
 * mutates branches under that role pair (migration 006), not a separate
 * "branch operator" role.
 */
export async function handleIssueBranchQr(req: AuthedRequest, res: Response): Promise<void> {
  const branchId = req.params.branchId;
  if (!branchId) {
    res.status(400).json({ error: 'branchId is required' });
    return;
  }

  const { data: branch, error } = await admin
    .from('branches')
    .select('id, company_id')
    .eq('id', branchId)
    .maybeSingle<{ id: string; company_id: string }>();

  if (error || !branch) {
    res.status(404).json({ error: 'Branch not found' });
    return;
  }

  if (!assertCompanyAccess(req, branch.company_id, res)) return;

  if (req.memberRole !== 'admin' && !['owner', 'manager'].includes(req.memberRole)) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }

  const issued = await issueBranchQrToken(admin, branchId);
  if (!issued) {
    res.status(404).json({ error: 'Branch not found' });
    return;
  }
  res.json(issued);
}
