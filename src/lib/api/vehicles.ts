import { supabase } from '../supabase';
import type { Vehicle, CreateVehicleInput } from '../database.types';

export async function listVehicles(transportCompanyId?: string): Promise<Vehicle[]> {
  let query = supabase.from('vehicles').select('*').order('plate_number');
  if (transportCompanyId) query = query.eq('transport_company_id', transportCompanyId);

  const { data, error } = await query;
  if (error) throw error;
  return (data as Vehicle[]) ?? [];
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

/** Deactivate a vehicle (soft) — sets status='inactive'. */
export async function deactivateVehicle(id: string): Promise<Vehicle> {
  return updateVehicle(id, { status: 'inactive' });
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
