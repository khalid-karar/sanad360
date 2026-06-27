import { supabase } from '../supabase';
import type { Vehicle, CreateVehicleInput } from '../database.types';

export async function listVehicles(): Promise<Vehicle[]> {
  const { data, error } = await supabase
    .from('vehicles')
    .select('*')
    .order('plate_number');

  if (error) throw error;
  return (data as Vehicle[]) ?? [];
}

export async function getFirstActiveVehicle(): Promise<Vehicle | null> {
  const { data, error } = await supabase
    .from('vehicles')
    .select('*')
    .eq('status', 'active')
    .limit(1)
    .single<Vehicle>();

  if (error) {
    if (error.code === 'PGRST116') return null;
    throw error;
  }
  return data;
}

export async function createVehicle(input: CreateVehicleInput): Promise<Vehicle> {
  const { data, error } = await supabase
    .from('vehicles')
    .insert(input)
    .select()
    .single<Vehicle>();

  if (error) throw error;
  return data;
}

export async function updateVehicle(
  id: string,
  input: Partial<Omit<Vehicle, 'id' | 'created_at' | 'transport_company_id'>>
): Promise<Vehicle> {
  const { data, error } = await supabase
    .from('vehicles')
    .update(input)
    .eq('id', id)
    .select()
    .single<Vehicle>();

  if (error) throw error;
  return data;
}
