import { supabase } from '../supabase';
import type { Branch } from '../database.types';

export interface CreateBranchInput {
  company_id: string;
  name_ar: string;
  name_en?: string;
  address_ar?: string;
  city?: string;
  geofence_lat?: number;
  geofence_lng?: number;
  geofence_radius_m?: number;
}

export type UpdateBranchInput = Partial<
  Omit<Branch, 'id' | 'company_id' | 'created_at'>
>;

/** List branches for a company (active + inactive). RLS still scopes to tenant. */
export async function listBranches(companyId?: string): Promise<Branch[]> {
  let query = supabase.from('branches').select('*').order('name_ar');
  if (companyId) query = query.eq('company_id', companyId);

  const { data, error } = await query;
  if (error) throw error;
  return (data as Branch[]) ?? [];
}

export async function createBranch(input: CreateBranchInput): Promise<Branch> {
  const { data, error } = await supabase
    .from('branches')
    .insert({
      geofence_radius_m: 150,
      ...input,
    })
    .select()
    .single<Branch>();

  if (error) throw error;
  return data;
}

export async function updateBranch(
  id: string,
  fields: UpdateBranchInput
): Promise<Branch> {
  const { data, error } = await supabase
    .from('branches')
    .update(fields)
    .eq('id', id)
    .select()
    .single<Branch>();

  if (error) throw error;
  return data;
}

/** Soft delete — sets status='inactive' so historical pickup_events stay intact. */
export async function deleteBranch(id: string): Promise<Branch> {
  return updateBranch(id, { status: 'inactive' });
}
