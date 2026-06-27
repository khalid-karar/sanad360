import { supabase } from '../supabase';
import type { Driver, CreateDriverInput } from '../database.types';

export async function listDrivers(): Promise<Driver[]> {
  const { data, error } = await supabase
    .from('drivers')
    .select('*')
    .order('name_ar');

  if (error) throw error;
  return (data as Driver[]) ?? [];
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
