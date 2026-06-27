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
  // Tenant context
  company_id: string | null;
  transport_company_id: string | null;
  branch_id: string | null;
  // For drivers: their drivers table row id
  driver_record_id: string | null;
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
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
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

  // Fetch membership
  const { data: membership, error: membershipError } = await supabase
    .from('memberships')
    .select('*')
    .eq('user_id', userId)
    .limit(1)
    .single<Membership>();

  if (membershipError) throw membershipError;

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
  };
}
