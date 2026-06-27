import { supabase } from '../supabase';
import type { PickupEvent, CreatePickupEventInput } from '../database.types';

// Error code prefixes from the BEFORE INSERT trigger
const TRIGGER_ERRORS: Record<string, string> = {
  BRANCH_NOT_FOUND: 'Branch not found.',
  BRANCH_COMPANY_MISMATCH: 'Branch does not belong to this company.',
  DRIVER_TRANSPORT_MISMATCH: 'Driver does not belong to this transport company.',
  VEHICLE_TRANSPORT_MISMATCH: 'Vehicle does not belong to this transport company.',
};

function mapTriggerError(rawMessage: string): string {
  for (const prefix of Object.keys(TRIGGER_ERRORS)) {
    if (rawMessage.startsWith(prefix)) {
      return TRIGGER_ERRORS[prefix];
    }
  }
  return rawMessage;
}

/**
 * Insert a brand-new pickup event (revision 1).
 * logical_id is generated client-side so callers can reference it
 * immediately; the server never needs to generate it.
 */
export async function createPickupEvent(input: CreatePickupEventInput): Promise<PickupEvent> {
  const logical_id = input.logical_id ?? crypto.randomUUID();

  const payload: CreatePickupEventInput = {
    ...input,
    logical_id,
    revision: 1,
    supersedes_id: undefined,
  };

  const { data, error } = await supabase
    .from('pickup_events')
    .insert(payload)
    .select()
    .single<PickupEvent>();

  if (error) {
    throw new Error(mapTriggerError(error.message));
  }
  return data;
}

/**
 * Correction: insert a new revision for an existing logical event.
 * Fetches the current latest revision to determine the next revision number.
 */
export async function createRevision(
  logicalId: string,
  input: Omit<CreatePickupEventInput, 'logical_id' | 'revision' | 'supersedes_id'>,
  reason: string
): Promise<PickupEvent> {
  // Find the current latest revision to get its id and revision number
  const { data: existing, error: fetchError } = await supabase
    .from('pickup_events')
    .select('id, revision')
    .eq('logical_id', logicalId)
    .order('revision', { ascending: false })
    .limit(1)
    .single<{ id: string; revision: number }>();

  if (fetchError) throw fetchError;

  const payload: CreatePickupEventInput = {
    ...input,
    logical_id: logicalId,
    revision: existing.revision + 1,
    supersedes_id: existing.id,
    notes: reason,
  };

  const { data, error } = await supabase
    .from('pickup_events')
    .insert(payload)
    .select()
    .single<PickupEvent>();

  if (error) {
    throw new Error(mapTriggerError(error.message));
  }
  return data;
}

export interface ListPickupsFilters {
  limit?: number;
  offset?: number;
  dateFrom?: string;    // ISO date string
  dateTo?: string;
  driverName?: string;  // free-text search (Phase 3 joins)
  complianceStatus?: string;
}

/**
 * List latest revision of each pickup event visible to the current user.
 * Reads from pickup_events_latest (security_invoker view) so RLS is enforced.
 */
export async function listPickups(filters: ListPickupsFilters = {}): Promise<PickupEvent[]> {
  let query = supabase
    .from('pickup_events_latest')
    .select('*')
    .order('created_at', { ascending: false });

  if (filters.dateFrom) {
    query = query.gte('created_at', filters.dateFrom);
  }
  if (filters.dateTo) {
    // Include the full day
    query = query.lte('created_at', filters.dateTo + 'T23:59:59Z');
  }
  if (filters.complianceStatus) {
    query = query.eq('compliance_status', filters.complianceStatus);
  }
  if (filters.limit) {
    query = query.limit(filters.limit);
  }
  if (filters.offset) {
    query = query.range(filters.offset, filters.offset + (filters.limit ?? 20) - 1);
  }

  const { data, error } = await query;
  if (error) throw error;
  return (data as PickupEvent[]) ?? [];
}

export async function getPickup(id: string): Promise<PickupEvent | null> {
  const { data, error } = await supabase
    .from('pickup_events')
    .select('*')
    .eq('id', id)
    .single<PickupEvent>();

  if (error) {
    if (error.code === 'PGRST116') return null;
    throw error;
  }
  return data;
}

/** Fetch all revisions of a logical event for audit display. */
export async function getPickupHistory(logicalId: string): Promise<PickupEvent[]> {
  const { data, error } = await supabase
    .from('pickup_events')
    .select('*')
    .eq('logical_id', logicalId)
    .order('revision', { ascending: true });

  if (error) throw error;
  return (data as PickupEvent[]) ?? [];
}
