import type { Response } from 'express';
import { admin } from '../lib/supabase.js';
import type { AuthedRequest } from '../types.js';

interface InviteRecyclerBody {
  facility_id?: string;
  role?: 'recycler_manager' | 'scale_operator';
  email?: string;
  temp_password?: string;
  name_ar?: string;
}

/**
 * POST /admin/invite-recycler
 *
 * Creates a recycler-side auth user + profile + facility membership.
 * facilities.INSERT/UPDATE are service_role-only (no self-registration — see
 * migration 018), so onboarding a facility and its first recycler_manager is
 * necessarily a server-side, admin-authorized action; this mirrors the
 * driver invite pattern (auth.admin.createUser + profile + membership),
 * using the service client for everything the browser cannot do. The
 * service-role key never leaves this process.
 *
 * Admin-only: unlike invite-driver (a transport owner/manager inviting into
 * THEIR OWN transport company), a facility's first recycler_manager has no
 * existing facility-side member to authorize the invite, so this requires
 * the platform admin role. Once a recycler_manager exists, THEY invite
 * additional scale_operators for their own facility (same endpoint, but
 * authorized via req.facilityId instead of admin).
 */
export async function handleInviteRecycler(req: AuthedRequest, res: Response): Promise<void> {
  const body = req.body as InviteRecyclerBody;
  const role = body.role;
  if (!body.facility_id || !body.email || !body.temp_password || !body.name_ar || !role) {
    res.status(400).json({ error: 'facility_id, role, email, temp_password and name_ar are required' });
    return;
  }
  if (!['recycler_manager', 'scale_operator'].includes(role)) {
    res.status(400).json({ error: "role must be 'recycler_manager' or 'scale_operator'" });
    return;
  }
  if (body.temp_password.length < 10) {
    res.status(400).json({ error: 'temp_password must be at least 10 characters' });
    return;
  }

  const isAdmin = req.memberRole === 'admin';
  const isOwnFacilityManager =
    req.memberRole === 'recycler_manager' && req.facilityId === body.facility_id;
  if (!isAdmin && !isOwnFacilityManager) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }
  // A recycler_manager may only invite scale_operators into their own
  // facility, never another recycler_manager (that stays admin-only).
  if (isOwnFacilityManager && role === 'recycler_manager') {
    res.status(403).json({ error: 'Forbidden: only an admin may invite a recycler_manager' });
    return;
  }

  const { data: facility, error: facilityErr } = await admin
    .from('facilities')
    .select('id')
    .eq('id', body.facility_id)
    .maybeSingle<{ id: string }>();
  if (facilityErr || !facility) {
    res.status(404).json({ error: 'Facility not found' });
    return;
  }

  try {
    // 1. Auth account (email pre-confirmed).
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email: body.email,
      password: body.temp_password,
      email_confirm: true,
      user_metadata: { name_ar: body.name_ar },
    });
    if (createErr || !created.user) {
      res.status(400).json({ error: `auth.createUser: ${createErr?.message ?? 'failed'}` });
      return;
    }
    const userId = created.user.id;

    // 2. Profile (handle_new_user trigger may have already inserted one).
    const { error: profileErr } = await admin
      .from('profiles')
      .upsert({ id: userId, name_ar: body.name_ar }, { onConflict: 'id' });
    if (profileErr) {
      res.status(400).json({ error: `profiles.upsert: ${profileErr.message}` });
      return;
    }

    // 3. Facility membership.
    const { error: memErr } = await admin.from('memberships').insert({
      user_id: userId,
      role,
      facility_id: body.facility_id,
    });
    if (memErr) {
      res.status(400).json({ error: `memberships.insert: ${memErr.message}` });
      return;
    }

    res.status(201).json({ user_id: userId, email: body.email, facility_id: body.facility_id, role });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Invite failed' });
  }
}

interface CreateFacilityBody {
  name_ar?: string;
  name_en?: string;
  license_number?: string;
  license_expiry?: string;
  city?: string;
  geofence_lat?: number;
  geofence_lng?: number;
  geofence_radius_m?: number;
}

/**
 * POST /admin/facilities
 *
 * facilities.INSERT is service_role-only (no self-registration — decision
 * confirmed in migration 018 review), so creating a new recycling facility
 * is an admin-only server action, same posture as onboard.ts for companies.
 */
export async function handleCreateFacility(req: AuthedRequest, res: Response): Promise<void> {
  if (req.memberRole !== 'admin') {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }
  const body = req.body as CreateFacilityBody;
  if (!body.name_ar) {
    res.status(400).json({ error: 'name_ar is required' });
    return;
  }

  const { data, error } = await admin
    .from('facilities')
    .insert({
      name_ar: body.name_ar,
      name_en: body.name_en ?? null,
      license_number: body.license_number ?? null,
      license_expiry: body.license_expiry ?? null,
      city: body.city ?? null,
      geofence_lat: body.geofence_lat ?? null,
      geofence_lng: body.geofence_lng ?? null,
      geofence_radius_m: body.geofence_radius_m ?? 150,
    })
    .select('id')
    .single<{ id: string }>();

  if (error || !data) {
    res.status(400).json({ error: `facilities.insert: ${error?.message ?? 'failed'}` });
    return;
  }

  res.status(201).json({ facility_id: data.id });
}
