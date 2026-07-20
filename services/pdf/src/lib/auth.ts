import type { Request, Response, NextFunction } from 'express';
import { admin } from './supabase.js';
import type { AuthedRequest } from '../types.js';

// Validates JWT and attaches userId + membership to the request.
// Rejects with 401/403 if the JWT is invalid or expired.
export async function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing Authorization header' });
    return;
  }

  const jwt = authHeader.slice(7);

  // Validate the JWT and get the user
  const { data: { user }, error: authError } = await admin.auth.getUser(jwt);
  if (authError || !user) {
    // Server-side only — never exposed in the response. The most common
    // cause of EVERY caller hitting this: this service's SUPABASE_URL /
    // SUPABASE_SERVICE_ROLE_KEY point at a DIFFERENT Supabase project than
    // the one that issued the caller's JWT (e.g. this host's env vars still
    // set to a stale/placeholder project while the frontend talks to the
    // real one) — signature verification then fails for every single token,
    // valid or not, even though this project is itself reachable.
    console.error('[authMiddleware] JWT validation failed:', authError?.message ?? 'no user returned');
    res.status(401).json({ error: 'Invalid or expired token' });
    return;
  }

  // Resolve the user's ACTIVE membership — same precedence as the DB helper
  // my_membership() (migration 012): the user_active_tenant selection wins,
  // otherwise the oldest membership.
  const { data: active } = await admin
    .from('user_active_tenant')
    .select('membership_id')
    .eq('user_id', user.id)
    .maybeSingle<{ membership_id: string }>();

  let membershipQuery = admin
    .from('memberships')
    .select('role, company_id, transport_company_id, facility_id')
    .eq('user_id', user.id);
  if (active?.membership_id) {
    membershipQuery = membershipQuery.eq('id', active.membership_id);
  } else {
    membershipQuery = membershipQuery
      .order('created_at', { ascending: true })
      .order('id', { ascending: true });
  }
  const { data: membership, error: memberError } = await membershipQuery.limit(1).single();

  if (memberError || !membership) {
    res.status(403).json({ error: 'No membership found for this user' });
    return;
  }

  const authed = req as AuthedRequest;
  authed.userId = user.id;
  authed.companyId = membership.company_id as string | null;
  authed.transportCompanyId = membership.transport_company_id as string | null;
  authed.facilityId = membership.facility_id as string | null;
  authed.memberRole = membership.role as string;

  next();
}

// Call this inside a route to verify the caller may access a given company's data.
export function assertCompanyAccess(
  req: AuthedRequest,
  companyId: string,
  res: Response
): boolean {
  if (req.memberRole === 'admin') return true;
  if (req.companyId === companyId) return true;
  res.status(403).json({ error: 'Access denied: tenant mismatch' });
  return false;
}
