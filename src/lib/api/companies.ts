import { supabase } from '../supabase';
import type { Company, Branch } from '../database.types';

export async function getMyCompany(): Promise<Company | null> {
  const { data, error } = await supabase
    .from('companies')
    .select('*')
    .limit(1)
    .single<Company>();

  if (error) {
    if (error.code === 'PGRST116') return null; // no rows
    throw error;
  }
  return data;
}

export async function getMyBranches(): Promise<Branch[]> {
  const { data, error } = await supabase
    .from('branches')
    .select('*')
    .order('name_ar');

  if (error) throw error;
  return (data as Branch[]) ?? [];
}

export async function getBranch(branchId: string): Promise<Branch | null> {
  const { data, error } = await supabase
    .from('branches')
    .select('*')
    .eq('id', branchId)
    .single<Branch>();

  if (error) {
    if (error.code === 'PGRST116') return null;
    throw error;
  }
  return data;
}
