import { supabase } from '../supabase';
import type { Driver, CreateDriverInput } from '../database.types';

export async function listDrivers(transportCompanyId?: string): Promise<Driver[]> {
  let query = supabase.from('drivers').select('*').order('name_ar');
  if (transportCompanyId) query = query.eq('transport_company_id', transportCompanyId);

  const { data, error } = await query;
  if (error) throw error;
  return (data as Driver[]) ?? [];
}

export type LicenseStatus = 'ok' | 'expiring' | 'expired';

/** Classify a license/expiry date string (YYYY-MM-DD) relative to today. */
export function licenseStatus(expiry: string, warnDays = 30): LicenseStatus {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const exp = new Date(expiry);
  const days = Math.ceil((exp.getTime() - today.getTime()) / 86400000);
  if (days < 0) return 'expired';
  if (days <= warnDays) return 'expiring';
  return 'ok';
}

export async function getDriver(id: string): Promise<Driver | null> {
  const { data, error } = await supabase
    .from('drivers')
    .select('*')
    .eq('id', id)
    .single<Driver>();

  if (error) {
    if (error.code === 'PGRST116') return null;
    throw error;
  }
  return data;
}

export async function createDriver(input: CreateDriverInput): Promise<Driver> {
  const { data, error } = await supabase
    .from('drivers')
    .insert(input)
    .select()
    .single<Driver>();

  if (error) throw error;
  return data;
}

/** Deactivate a driver (soft) — sets status='inactive'. */
export async function deactivateDriver(id: string): Promise<Driver> {
  return updateDriver(id, { status: 'inactive' });
}

export async function updateDriver(
  id: string,
  input: Partial<Omit<Driver, 'id' | 'created_at' | 'transport_company_id'>>
): Promise<Driver> {
  const { data, error } = await supabase
    .from('drivers')
    .update(input)
    .eq('id', id)
    .select()
    .single<Driver>();

  if (error) throw error;
  return data;
}
