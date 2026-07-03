import type { Response } from 'express';
import { admin } from '../lib/supabase.js';
import type { AuthedRequest } from '../types.js';

interface InviteDriverBody {
  /** drivers table row id — must belong to the caller's transport company. */
  driver_id?: string;
  /** Saudi mobile used to build the synthetic login email ({digits}@driver.sanad360.com). */
  phone?: string;
  temp_password?: string;
  /** Optional: pin the driver to a branch (memberships.branch_id). */
  branch_id?: string;
}

const DRIVER_EMAIL_DOMAIN = 'driver.sanad360.com';

/**
 * POST /transport/invite-driver
 *
 * Turns a fleet driver RECORD into a driver who can actually sign in. Runs
 * behind authMiddleware; additionally requires the caller to be a transport
 * owner/manager/dispatcher, and the driver row to belong to the caller's own
 * transport company with no linked account yet.
 *
 * Uses the service client for auth.admin.createUser + the profile/membership/
 * drivers.profile_id writes — none of which the browser may perform (auth
 * admin needs service role; memberships are deliberately SELECT-only for
 * authenticated). The service-role key never leaves this process.
 */
export async function handleInviteDriver(req: AuthedRequest, res: Response): Promise<void> {
  // Transport-side managers only.
  if (
    !req.transportCompanyId ||
    !['owner', 'manager', 'dispatcher'].includes(req.memberRole)
  ) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }

  const body = req.body as InviteDriverBody;
  const phoneDigits = (body.phone ?? '').replace(/\D/g, '');
  if (!body.driver_id || !phoneDigits || !body.temp_password) {
    res.status(400).json({ error: 'driver_id, phone and temp_password are required' });
    return;
  }
  if (body.temp_password.length < 10) {
    res.status(400).json({ error: 'temp_password must be at least 10 characters' });
    return;
  }

  // Driver row must belong to the caller's transport company and be un-linked.
  const { data: driver, error: driverErr } = await admin
    .from('drivers')
    .select('id, name_ar, transport_company_id, profile_id')
    .eq('id', body.driver_id)
    .maybeSingle<{
      id: string;
      name_ar: string;
      transport_company_id: string;
      profile_id: string | null;
    }>();

  if (driverErr || !driver || driver.transport_company_id !== req.transportCompanyId) {
    res.status(404).json({ error: 'Driver not found in your transport company' });
    return;
  }
  if (driver.profile_id) {
    res.status(409).json({ error: 'Driver already has a linked account' });
    return;
  }

  // Optional branch pin must belong to a company actively linked to the caller.
  if (body.branch_id) {
    const { data: linkedBranch } = await admin
      .from('branches')
      .select('id, company_id')
      .eq('id', body.branch_id)
      .maybeSingle<{ id: string; company_id: string }>();
    if (!linkedBranch) {
      res.status(400).json({ error: 'branch_id does not exist' });
      return;
    }
    const { data: link } = await admin
      .from('company_transporters')
      .select('id')
      .eq('company_id', linkedBranch.company_id)
      .eq('transport_company_id', req.transportCompanyId)
      .eq('status', 'active')
      .maybeSingle<{ id: string }>();
    if (!link) {
      res.status(400).json({ error: 'branch_id belongs to a company you are not linked to' });
      return;
    }
  }

  const email = `${phoneDigits}@${DRIVER_EMAIL_DOMAIN}`;

  try {
    // 1. Auth account (email pre-confirmed; drivers sign in with phone-email).
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      password: body.temp_password,
      email_confirm: true,
      user_metadata: { name_ar: driver.name_ar },
    });
    if (createErr || !created.user) {
      res.status(400).json({ error: `auth.createUser: ${createErr?.message ?? 'failed'}` });
      return;
    }
    const userId = created.user.id;

    // 2. Profile (handle_new_user trigger may have already inserted one).
    const { error: profileErr } = await admin
      .from('profiles')
      .upsert({ id: userId, name_ar: driver.name_ar, phone: phoneDigits }, { onConflict: 'id' });
    if (profileErr) {
      res.status(400).json({ error: `profiles.upsert: ${profileErr.message}` });
      return;
    }

    // 3. Driver membership in the caller's transport company.
    const { error: memErr } = await admin.from('memberships').insert({
      user_id: userId,
      role: 'driver',
      transport_company_id: req.transportCompanyId,
      branch_id: body.branch_id ?? null,
    });
    if (memErr) {
      res.status(400).json({ error: `memberships.insert: ${memErr.message}` });
      return;
    }

    // 4. Link the fleet record to the account.
    const { error: linkErr } = await admin
      .from('drivers')
      .update({ profile_id: userId, phone: phoneDigits })
      .eq('id', driver.id);
    if (linkErr) {
      res.status(400).json({ error: `drivers.update: ${linkErr.message}` });
      return;
    }

    res.status(201).json({ user_id: userId, email });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Invite failed' });
  }
}
