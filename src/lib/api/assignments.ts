import { supabase } from '../supabase';
import type {
  PickupAssignment,
  CreateAssignmentInput,
  AssignmentStatus,
} from '../database.types';

// ─────────────────────────────────────────────────────────────────────────────
// RLS VISIBILITY (implemented by the SELECT/UPDATE policies in 003_phase3.sql)
//
//   • Company members (owner / manager / dispatcher):
//       see ALL assignments for their company — the `pickup_assignments_select`
//       policy matches `company_id = (my_membership()).company_id`.
//
//   • Drivers:
//       see ONLY assignments whose `driver_id` is one of the drivers belonging
//       to the caller's transport company. The policy resolves this with:
//         driver_id IN (SELECT d.id FROM drivers d
//                       WHERE d.transport_company_id = (my_membership()).transport_company_id)
//       In practice each driver acts on their own driver record, so the UI
//       additionally filters by the caller's own driver_id (see MySchedulePage).
//
//   • Admins:
//       see everything ((my_membership()).role = 'admin').
//
//   INSERT is restricted to owner/manager/dispatcher of the owning company;
//   UPDATE is allowed for those roles OR a driver in the assigned transport
//   company (so drivers can accept / start / complete their own work).
//
//   Because all access is enforced server-side by RLS, these API helpers never
//   need to re-check the tenant — they simply issue the query and let Postgres
//   filter. The helpers below are thin, type-safe wrappers over that.
// ─────────────────────────────────────────────────────────────────────────────

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
  const patch: Partial<PickupAssignment> = { status };
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

/**
 * Complete an assignment: link the just-created pickup_event and flip status to
 * 'completed'. The pickup_event itself is created via createPickupEvent() so the
 * append-only ledger trigger (risk score + geofence) runs server-side first.
 */
export async function completeAssignment(
  assignmentId: string,
  pickupEventId: string
): Promise<PickupAssignment> {
  return updateAssignmentStatus(assignmentId, 'completed', pickupEventId);
}

// NOTE: getTransportCompanyForCompany() (the most-recent-pickup-event hack) was
// removed in phase3c. Schedule screens now resolve eligible drivers/vehicles via
// the explicit company_transporters link — see
// src/lib/api/companyTransporters.ts → getDriversAndVehiclesForCompany().
