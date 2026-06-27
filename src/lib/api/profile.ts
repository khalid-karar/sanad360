import { supabase } from '../supabase';
import type { Profile } from '../database.types';

export interface UpdateProfileInput {
  name_en?: string;
  name_ar?: string;
  phone?: string;
}

export async function getMyProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single<Profile>();

  if (error) {
    if (error.code === 'PGRST116') return null;
    throw error;
  }
  return data;
}

/** Update the caller's own profile (RLS restricts to own row). */
export async function updateProfile(
  userId: string,
  input: UpdateProfileInput
): Promise<Profile> {
  const { data, error } = await supabase
    .from('profiles')
    .update(input)
    .eq('id', userId)
    .select()
    .single<Profile>();

  if (error) throw error;
  return data;
}
