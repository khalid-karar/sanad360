import type { Response } from 'express';
import { admin } from '../lib/supabase.js';
import { issueTripQrToken, verifyTripQrToken } from '../lib/tripQr.js';
import type { AuthedRequest, TripRow, FacilityRow, DriverRow, VehicleRow } from '../types.js';

/**
 * POST /trips/:tripId/qr
 *
 * Issues a short-TTL, HMAC-signed QR token for the driver app to render at
 * dropoff. Only a member of the trip's own transport company (staff, or the
 * assigned driver themselves) may request one — mirrors the trips RLS SELECT
 * policy so a token can never be minted for a trip the caller couldn't
 * already see.
 */
export async function handleIssueTripQr(req: AuthedRequest, res: Response): Promise<void> {
  const tripId = req.params.tripId;
  if (!tripId) {
    res.status(400).json({ error: 'tripId is required' });
    return;
  }

  const { data: trip, error } = await admin
    .from('trips')
    .select('id, transport_company_id, driver_id, status')
    .eq('id', tripId)
    .maybeSingle<Pick<TripRow, 'id' | 'transport_company_id' | 'driver_id' | 'status'>>();

  if (error || !trip) {
    res.status(404).json({ error: 'Trip not found' });
    return;
  }
  if (trip.transport_company_id !== req.transportCompanyId) {
    res.status(403).json({ error: 'Access denied: tenant mismatch' });
    return;
  }
  if (req.memberRole === 'driver') {
    const { data: driverRow } = await admin
      .from('drivers')
      .select('id')
      .eq('id', trip.driver_id)
      .eq('profile_id', req.userId)
      .maybeSingle<{ id: string }>();
    if (!driverRow) {
      res.status(403).json({ error: 'Access denied: not the assigned driver' });
      return;
    }
  } else if (!['owner', 'manager', 'dispatcher'].includes(req.memberRole)) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }
  if (trip.status === 'cancelled' || trip.status === 'reconciled') {
    res.status(409).json({ error: `Trip is already ${trip.status}` });
    return;
  }

  const issued = issueTripQrToken(tripId);
  res.json(issued);
}

/**
 * POST /recycler/validate-trip-qr
 *
 * The receiving facility's scale scans the driver's QR and posts the token
 * here. Rejects expired/tampered tokens; on success, returns just enough of
 * the trip for the confirm screen — never the raw trip_id alone would have
 * been enough to trust (that's exactly what the HMAC signature guards
 * against). The facility mismatch check ensures a scale_operator can only
 * open trips actually planned for THEIR OWN facility.
 */
export async function handleValidateTripQr(req: AuthedRequest, res: Response): Promise<void> {
  if (!['recycler_manager', 'scale_operator'].includes(req.memberRole) || !req.facilityId) {
    res.status(403).json({ error: 'Forbidden: recycler facility membership required' });
    return;
  }

  const { token } = req.body as { token?: string };
  if (!token) {
    res.status(400).json({ error: 'token is required' });
    return;
  }

  const result = verifyTripQrToken(token);
  if (!result.ok) {
    const statusByReason = { malformed: 400, tampered: 401, expired: 410 } as const;
    res.status(statusByReason[result.reason]).json({ error: `QR token ${result.reason}` });
    return;
  }

  const { data: trip, error } = await admin
    .from('trips')
    .select('*')
    .eq('id', result.tripId)
    .maybeSingle<TripRow>();

  if (error || !trip) {
    res.status(404).json({ error: 'Trip not found' });
    return;
  }
  if (trip.planned_facility_id !== req.facilityId) {
    res.status(403).json({ error: 'This trip was not planned for your facility' });
    return;
  }

  const [facilityRes, driverRes, vehicleRes] = await Promise.all([
    admin.from('facilities').select('id, name_ar, name_en, license_number, city').eq('id', trip.planned_facility_id).maybeSingle<FacilityRow>(),
    admin.from('drivers').select('id, name_ar, license_number, license_expiry').eq('id', trip.driver_id).maybeSingle<DriverRow>(),
    admin.from('vehicles').select('id, plate_number, type, ncwm_license_number, ncwm_license_expiry').eq('id', trip.vehicle_id).maybeSingle<VehicleRow>(),
  ]);

  res.json({
    trip,
    facility: facilityRes.data ?? null,
    driver: driverRes.data ?? null,
    vehicle: vehicleRes.data ?? null,
  });
}
