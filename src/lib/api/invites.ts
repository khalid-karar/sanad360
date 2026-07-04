import { supabase } from '../supabase';
import { PDF_SERVICE_URL } from '../pdfServiceUrl';

export interface InviteDriverResult {
  user_id: string;
  email: string;
}

/**
 * Invite a fleet driver: creates their auth account (synthetic
 * {phone}@driver.sanad360.com email), driver membership, and links
 * drivers.profile_id. Server-side endpoint — requires the caller to be a
 * transport owner/manager/dispatcher.
 */
export async function inviteDriver(
  driverId: string,
  phone: string,
  tempPassword: string,
  branchId?: string
): Promise<InviteDriverResult> {
  const { data: { session }, error } = await supabase.auth.getSession();
  if (error || !session) throw new Error('Not authenticated');

  const res = await fetch(`${PDF_SERVICE_URL}/transport/invite-driver`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({
      driver_id: driverId,
      phone,
      temp_password: tempPassword,
      branch_id: branchId,
    }),
  });

  if (!res.ok) {
    let message = `Invite failed (${res.status})`;
    try {
      const json = await res.json() as { error?: string };
      if (json.error) message = json.error;
    } catch { /* ignore parse error */ }
    throw new Error(message);
  }
  return res.json() as Promise<InviteDriverResult>;
}
