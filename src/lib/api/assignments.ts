import { supabase } from '../supabase';
import type {
  PickupAssignment,
  CreateAssignmentInput,
  AssignmentStatus,
} from '../database.types';

export interface ListAssignmentsFilters {
  companyId?: string;
  driverId?: string;
  status?: AssignmentStatus;
  upcomingOnly?: boolean;
}

/**
 * List assignments visible to the current user (RLS scopes by company or driver).
 */
export async function listAssignments(
  filters: ListAssignmentsFilters = {}
): Promise<PickupAssignment[]> {
  let query = supabase
    .from('pickup_assignments')
    .select('*')
    .order('scheduled_at', { ascending: true });

  if (filters.companyId) query = query.eq('company_id', filters.companyId);
  if (filters.driverId) query = query.eq('driver_id', filters.driverId);
  if (filters.status) query = query.eq('status', filters.status);
  if (filters.upcomingOnly) query = query.gte('scheduled_at', new Date().toISOString());

  const { data, error } = await query;
  if (error) throw error;
  return (data as PickupAssignment[]) ?? [];
}

export async function createAssignment(
  input: CreateAssignmentInput
): Promise<PickupAssignment> {
  const { data, error } = await supabase
    .from('pickup_assignments')
    .insert(input)
    .select()
    .single<PickupAssignment>();

  if (error) throw error;
  return data;
}

/**
 * Update an assignment's status. Optionally link a pickup_event_id (set when
 * the work is completed). The DB updated_at trigger refreshes the timestamp.
 */
export async function updateAssignmentStatus(
  id: string,
  status: AssignmentStatus,
  pickupEventId?: string
): Promise<PickupAssignment> {
  const patch: Record<string, unknown> = { status };
  if (pickupEventId) patch.pickup_event_id = pickupEventId;

  const { data, error } = await supabase
    .from('pickup_assignments')
    .update(patch)
    .eq('id', id)
    .select()
    .single<PickupAssignment>();

  if (error) throw error;
  return data;
}
