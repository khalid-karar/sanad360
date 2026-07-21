import { supabase } from '../supabase';
import type { Industry } from '../database.types';

/** Bilingual industry lookup (migration 028), active entries only, ordered for display. */
export async function listIndustries(): Promise<Industry[]> {
  const { data, error } = await supabase
    .from('industries')
    .select('*')
    .eq('is_active', true)
    .order('sort_order');
  if (error) throw error;
  return (data as Industry[]) ?? [];
}
