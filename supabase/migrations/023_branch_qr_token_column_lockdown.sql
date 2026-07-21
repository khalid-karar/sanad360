-- ═══════════════════════════════════════════════════════════════════════════
-- CP3 follow-up — close a live secret-exposure hole left by 022.
--
-- 022 turned branches.qr_token into a server-only HMAC signing secret (never
-- displayed to any client) and moved verification to a signed, short-TTL
-- token issued by services/pdf. But the table-level GRANTs from 001/006/007
-- (SELECT to authenticated; INSERT, UPDATE to authenticated) were never
-- revisited: RLS filters ROWS, not COLUMNS, so any caller who can already see
-- a branch row (its own company's owner/manager, AND — per migration 009 —
-- any linked transporter, i.e. a driver's own client) can still run
-- `.from('branches').select('qr_token')` today and get the raw secret back.
-- Worse than a read leak: the table-level UPDATE grant means the same caller
-- could overwrite qr_token with a value of their own choosing, letting them
-- forge arbitrarily many valid HMACs themselves — a full bypass of 022's
-- Part B, not just an exposure.
--
-- The table-level INSERT grant (006) has the same problem one step earlier:
-- a client could set qr_token to a chosen value AT CREATION time via a raw
-- REST insert payload, defeating secrecy from the branch's first row.
--
-- FIX: replace the table-level SELECT/UPDATE/INSERT grants with column-level
-- ones that exclude qr_token entirely. service_role is untouched (it never
-- went through these GRANTs to authenticated in the first place) — every
-- services/pdf read of qr_token uses the service-role `admin` client, and
-- qr_token's DEFAULT gen_random_uuid() (013) still fires on INSERT without
-- the client ever needing to reference the column.
-- ═══════════════════════════════════════════════════════════════════════════

REVOKE SELECT, UPDATE, INSERT ON public.branches FROM authenticated;

GRANT SELECT (
  id, company_id, name_ar, name_en, address_ar, city,
  geofence_lat, geofence_lng, geofence_radius_m, status, created_at
) ON public.branches TO authenticated;

GRANT INSERT (
  id, company_id, name_ar, name_en, address_ar, city,
  geofence_lat, geofence_lng, geofence_radius_m, status
) ON public.branches TO authenticated;

GRANT UPDATE (
  name_ar, name_en, address_ar, city,
  geofence_lat, geofence_lng, geofence_radius_m, status
) ON public.branches TO authenticated;
