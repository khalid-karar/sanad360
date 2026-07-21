import { supabase } from '../supabase';
import { BRANCH_COLUMNS } from './branches';
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
    .select(BRANCH_COLUMNS)
    .order('name_ar');

  if (error) throw error;
  return (data as Branch[]) ?? [];
}

/**
 * Fetch one company by id. Visible to its own members, admins, and (since
 * migration 009) transport members actively linked via company_transporters —
 * drivers need the client company's name on their assignment cards.
 */
export async function getCompany(companyId: string): Promise<Company | null> {
  const { data, error } = await supabase
    .from('companies')
    .select('*')
    .eq('id', companyId)
    .single<Company>();

  if (error) {
    if (error.code === 'PGRST116') return null;
    throw error;
  }
  return data;
}

export async function getBranch(branchId: string): Promise<Branch | null> {
  const { data, error } = await supabase
    .from('branches')
    .select(BRANCH_COLUMNS)
    .eq('id', branchId)
    .single<Branch>();

  if (error) {
    if (error.code === 'PGRST116') return null;
    throw error;
  }
  return data;
}
