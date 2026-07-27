import type { Request, Response, NextFunction } from 'express';
import { isAuthRetryableFetchError } from '@supabase/supabase-js';
import { admin } from './supabase.js';
import type { AuthedRequest } from '../types.js';

const GET_USER_MAX_ATTEMPTS = 3;
const GET_USER_RETRY_BACKOFF_MS = 100;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type GetUserResult = Awaited<ReturnType<typeof admin.auth.getUser>>;

/**
 * admin.auth.getUser(jwt) never throws for an auth-related failure — GoTrue
 * client-library errors are caught internally and returned as
 * `{ data: { user: null }, error }`, not thrown (confirmed by reading
 * @supabase/auth-js's _getUser()/handleError()). Empirically confirmed
 * locally (300 concurrent calls against a real local GoTrue): ~20% failed
 * with a genuine socket-level connection reset, surfacing as
 * AuthRetryableFetchError with status 0 — a real, well-formed error object,
 * not a thrown exception and not "no error at all."
 *
 * That status-0 shape used to fall through this middleware's old
 * status-number heuristic (`status === undefined || status >= 500`) — 0 is
 * neither undefined nor >= 500 — misclassifying a transient network blip as
 * "your token is invalid" (401) instead of "auth service temporarily
 * unavailable" (503). A bounded retry fixes the PRODUCTION problem, not
 * just the classification: a single dropped connection to GoTrue shouldn't
 * ever look like a real user got logged out, when trying again a moment
 * later would have worked. A genuinely invalid/expired token (a real 4xx
 * response from GoTrue) is never retried — GoTrue already answered
 * definitively, and retrying would just confirm the same rejection twice
 * more.
 */
async function getUserWithRetry(jwt: string): Promise<GetUserResult> {
  let last: GetUserResult | undefined;
  for (let attempt = 1; attempt <= GET_USER_MAX_ATTEMPTS; attempt++) {
    const result = await admin.auth.getUser(jwt);
    if (result.data.user) return result;
    last = result;
    if (!isAuthRetryableFetchError(result.error)) return result;
    if (attempt < GET_USER_MAX_ATTEMPTS) await sleep(GET_USER_RETRY_BACKOFF_MS * attempt);
  }
  return last!;
}

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
  const { data: { user }, error: authError } = await getUserWithRetry(jwt);
  if (authError || !user) {
    // Server-side only — never exposed in the response. The most common
    // cause of EVERY caller hitting this: this service's SUPABASE_URL /
    // SUPABASE_SERVICE_ROLE_KEY point at a DIFFERENT Supabase project than
    // the one that issued the caller's JWT (e.g. this host's env vars still
    // set to a stale/placeholder project while the frontend talks to the
    // real one) — signature verification then fails for every single token,
    // valid or not, even though this project is itself reachable.
    console.error('[authMiddleware] JWT validation failed:', authError?.message ?? 'no user returned');

    // isAuthRetryableFetchError() is the SAME check @supabase/auth-js uses
    // internally to decide a failure is transient (network blip / GoTrue
    // 5xx) rather than a definitive rejection — using the library's own
    // canonical check here instead of a hand-rolled status-number
    // comparison is what catches the status-0 case above. Anything else
    // (a real 4xx, or the pathological "no error object at all" case with
    // nothing to distinguish it by) stays 401 — a safe default, since the
    // token is unusable either way.
    if (isAuthRetryableFetchError(authError)) {
      res.status(503).json({ error: 'Auth service temporarily unavailable — please retry' });
      return;
    }
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
    .select('role, company_id, transport_company_id, facility_id, branch_id')
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
  authed.branchId = membership.branch_id as string | null;
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
