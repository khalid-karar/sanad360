import { supabase } from '../supabase';
import { uploadEvidenceFile } from './storage';
import type {
  DisposalConfirmation,
  CreateDisposalConfirmationInput,
  PickupEvent,
} from '../database.types';

const TICKETS_BUCKET = 'disposal-tickets';

/** A completed pickup event still awaiting its disposal confirmation. */
export interface PendingDelivery {
  event: PickupEvent;
}

/**
 * List this driver's completed pickup events that have no disposal
 * confirmation yet. RLS already scopes both queries: drivers see their own
 * events (created_by arm) and their transport company's confirmations.
 */
export async function listPendingDeliveries(): Promise<PendingDelivery[]> {
  const { data: events, error } = await supabase
    .from('pickup_events_latest')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) throw error;

  const rows = (events as PickupEvent[]) ?? [];
  if (rows.length === 0) return [];

  const { data: confirmations, error: confErr } = await supabase
    .from('disposal_confirmations')
    .select('pickup_event_id')
    .in('pickup_event_id', rows.map((e) => e.id));
  if (confErr) throw confErr;

  const confirmed = new Set(
    ((confirmations as { pickup_event_id: string }[]) ?? []).map((c) => c.pickup_event_id)
  );
  return rows.filter((e) => !confirmed.has(e.id)).map((event) => ({ event }));
}

/** Fetch the confirmation for one pickup event (null when not yet confirmed). */
export async function getDisposalConfirmation(
  pickupEventId: string
): Promise<DisposalConfirmation | null> {
  const { data, error } = await supabase
    .from('disposal_confirmations')
    .select('*')
    .eq('pickup_event_id', pickupEventId)
    .maybeSingle<DisposalConfirmation>();
  if (error) throw error;
  return data;
}

/**
 * Record the disposal leg: upload the weighbridge ticket (hashed client-side,
 * re-verifiable server-side) into the event's tenant prefix, then append the
 * confirmation row. Tenant fields + created_by are forced by the DB trigger.
 */
export async function createDisposalConfirmation(
  event: Pick<PickupEvent, 'id' | 'company_id' | 'branch_id'>,
  input: Omit<CreateDisposalConfirmationInput, 'pickup_event_id' | 'ticket_path' | 'ticket_sha256'>,
  ticketFile?: File
): Promise<DisposalConfirmation> {
  let ticket_path: string | undefined;
  let ticket_sha256: string | undefined;

  if (ticketFile) {
    const ext = ticketFile.name.split('.').pop() ?? 'jpg';
    const path = `${event.company_id}/${event.branch_id}/${event.id}/ticket.${ext}`;
    const uploaded = await uploadEvidenceFile(
      TICKETS_BUCKET,
      path,
      ticketFile,
      ticketFile.type || 'image/jpeg'
    );
    ticket_path = uploaded.path;
    ticket_sha256 = uploaded.sha256;
  }

  const { data, error } = await supabase
    .from('disposal_confirmations')
    .insert({
      pickup_event_id: event.id,
      ...input,
      ticket_path,
      ticket_sha256,
      // company/branch/transport ids are server-set by the BEFORE INSERT
      // trigger from the referenced event; we do not send them.
    })
    .select()
    .single<DisposalConfirmation>();

  if (error) throw error;
  return data;
}
