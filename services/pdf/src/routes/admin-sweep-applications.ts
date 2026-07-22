import type { Request, Response } from 'express';
import { admin, anon } from '../lib/supabase.js';

/**
 * POST /admin/sweep-stale-applications
 *
 * Manual invocation path for public.sweep_stale_unverified_applications()
 * (migration 036) — deletes any pending_applications row still stuck in
 * 'pending_email_verification' past its email_verification_expires_at,
 * freeing the commercial_registration slot it was squatting (see 036's
 * header for the CR-squatting hole this closes). No pg_cron wiring exists
 * yet (see PRODUCTION_HARDENING.md); this endpoint exists so staging/CP11
 * demo seeding can exercise the transition on demand, without needing raw
 * service-role DB access or a real 24h wait — same shape as
 * /admin/sweep-expired-confirmations (030).
 *
 * Auth model — service-role OR admin, deliberately NEVER a plain
 * authenticated (tenant) caller, mirroring onboard.ts's/the confirmations
 * sweep's "not the shared authMiddleware" posture:
 *   - Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY> — for headless
 *     scripts that have the service key but no human session.
 *   - Authorization: Bearer <admin's own JWT> — validated the same way
 *     onboard.ts validates one (anon.auth.getUser + admin-membership check).
 * Any other caller, or a caller with no membership at all, gets 403 with no
 * information leak.
 */
export async function handleSweepStaleApplications(req: Request, res: Response): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }
  const token = authHeader.slice(7);

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const isServiceRole = !!serviceRoleKey && token === serviceRoleKey;

  if (!isServiceRole) {
    if (!anon) {
      res.status(500).json({ error: 'Server missing SUPABASE_ANON_KEY' });
      return;
    }
    const { data: userData, error: userErr } = await anon.auth.getUser(token);
    if (userErr || !userData.user) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    const { data: membership } = await admin
      .from('memberships')
      .select('role')
      .eq('user_id', userData.user.id)
      .eq('role', 'admin')
      .maybeSingle<{ role: string }>();
    if (!membership) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
  }

  const { data, error } = await admin.rpc('sweep_stale_unverified_applications');
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  res.json({ swept: data as number });
}
