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
    res.status(401).json({ error: 'Invalid or expired token' });
    return;
  }

  // Fetch the user's membership (LIMIT 1 — single-tenant Phase 1 behaviour)
  const { data: membership, error: memberError } = await admin
    .from('memberships')
    .select('role, company_id, transport_company_id')
    .eq('user_id', user.id)
    .limit(1)
    .single();

  if (memberError || !membership) {
    res.status(403).json({ error: 'No membership found for this user' });
    return;
  }

  const authed = req as AuthedRequest;
  authed.userId = user.id;
  authed.companyId = membership.company_id as string | null;
  authed.transportCompanyId = membership.transport_company_id as string | null;
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
