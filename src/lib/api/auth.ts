import { supabase } from '../supabase';
import type { Profile, Membership, MemberRole } from '../database.types';

// Re-export so consumers (e.g. authStore) can import the role union from here.
export type { MemberRole };

export interface AuthUser {
  id: string;
  name: string;
  role: MemberRole;
  email: string | null;
  phone: string | null;
  // Tenant context (from the ACTIVE membership — see migration 012)
  company_id: string | null;
  transport_company_id: string | null;
  branch_id: string | null;
  // For drivers: their drivers table row id
  driver_record_id: string | null;
  /** All memberships this user holds (consultants hold several). */
  memberships: Membership[];
  /** The membership currently acted as — mirrors my_membership() server-side. */
  active_membership_id: string;
}

export interface SignInResult {
  user: AuthUser;
}

/** Sign in with email + password. Fetches profile + membership after auth. */
export async function signIn(email: string, password: string): Promise<SignInResult> {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  if (!data.user) throw new Error('Sign in failed: no user returned');

  const user = await fetchMyProfile(data.user.id);
  return { user };
}

export async function signOut(): Promise<void> {
  // Race signOut against a 3-second timeout so a hanging network call (e.g. an
  // unhealthy local Supabase or an already-invalid JWT) never blocks logout
  // navigation. Local auth state is cleared by the caller regardless.
  // scope:'local' signs out THIS browser only. The default ('global')
  // revokes the refresh-token family everywhere — which is why signing out
  // on one device used to break every other logged-in browser at once.
  await Promise.race([
    supabase.auth.signOut({ scope: 'local' }),
    new Promise<void>((resolve) => setTimeout(resolve, 3000)),
  ]);
}

export async function getSession() {
  const { data } = await supabase.auth.getSession();
  return data.session;
}

/**
 * Fetches the caller's profile + membership and assembles an AuthUser.
 * Called after sign-in and on session hydration.
 */
export async function fetchMyProfile(userId: string): Promise<AuthUser> {
  // Fetch profile
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single<Profile>();

  if (profileError) throw profileError;

  // All memberships, oldest first — mirrors my_membership()'s fallback order.
  const { data: membershipRows, error: membershipError } = await supabase
    .from('memberships')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true });

  if (membershipError) throw membershipError;
  const memberships = (membershipRows as Membership[]) ?? [];
  if (memberships.length === 0) throw new Error('No membership found for this user');

  // Active-tenant selection (migration 012); fall back to the oldest.
  const { data: active } = await supabase
    .from('user_active_tenant')
    .select('membership_id')
    .eq('user_id', userId)
    .maybeSingle<{ membership_id: string }>();

  const membership =
    memberships.find((m) => m.id === active?.membership_id) ?? memberships[0];

  // For driver role: look up their drivers table row by profile_id
  let driverRecordId: string | null = null;
  if (membership.role === 'driver') {
    const { data: driverRow } = await supabase
      .from('drivers')
      .select('id')
      .eq('profile_id', userId)
      .single<{ id: string }>();
    driverRecordId = driverRow?.id ?? null;
  }

  return {
    id: userId,
    name: profile.name_ar,
    role: membership.role,
    email: null,
    phone: profile.phone,
    company_id: membership.company_id,
    transport_company_id: membership.transport_company_id,
    branch_id: membership.branch_id,
    driver_record_id: driverRecordId,
    memberships,
    active_membership_id: membership.id,
  };
}

/**
 * Switch the caller's active tenant (consultant flow). Upserts the selection
 * row that my_membership() prefers server-side; callers should re-hydrate the
 * AuthUser afterwards so client state matches RLS reality.
 */
export async function setActiveTenant(userId: string, membershipId: string): Promise<void> {
  const { error } = await supabase
    .from('user_active_tenant')
    .upsert(
      { user_id: userId, membership_id: membershipId, updated_at: new Date().toISOString() },
      { onConflict: 'user_id' }
    );
  if (error) throw error;
}
