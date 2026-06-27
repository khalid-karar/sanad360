import { supabase } from '../supabase';
import { licenseStatus } from './drivers';
import type { Driver, Vehicle, PickupEvent, PickupAssignment } from '../database.types';

export type AlertSeverity = 'warning' | 'critical';

export interface DerivedAlert {
  key: string;            // stable identity, used for acknowledgement dedup
  severity: AlertSeverity;
  category:
    | 'driver_expiry'
    | 'vehicle_expiry'
    | 'non_compliant_pickup'
    | 'missed_assignment';
  titleAr: string;
  titleEn: string;
  detailAr: string;
  detailEn: string;
}

/**
 * Derive live alerts from real data. Acknowledged alerts (per company) are
 * filtered out. Visibility follows RLS — a company user only sees its own
 * pickups/assignments; transport drivers/vehicles surface for transport users.
 */
export async function getAlerts(companyId: string): Promise<DerivedAlert[]> {
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 86400000).toISOString();

  const [driversRes, vehiclesRes, pickupsRes, assignmentsRes, acksRes] =
    await Promise.all([
      supabase.from('drivers').select('*'),
      supabase.from('vehicles').select('*'),
      supabase
        .from('pickup_events_latest')
        .select('*')
        .eq('compliance_status', 'non_compliant')
        .gte('created_at', sevenDaysAgo),
      supabase
        .from('pickup_assignments')
        .select('*')
        .eq('status', 'pending')
        .lt('scheduled_at', now.toISOString()),
      supabase
        .from('alert_acknowledgements')
        .select('alert_key')
        .eq('company_id', companyId),
    ]);

  const alerts: DerivedAlert[] = [];

  for (const d of (driversRes.data as Driver[]) ?? []) {
    if (d.status !== 'active') continue;
    const st = licenseStatus(d.license_expiry, 30);
    if (st === 'ok') continue;
    alerts.push({
      key: `driver_expiry:${d.id}`,
      severity: st === 'expired' ? 'critical' : 'warning',
      category: 'driver_expiry',
      titleAr: 'انتهاء رخصة سائق',
      titleEn: 'Driver license issue',
      detailAr: `رخصة السائق ${d.name_ar} ${st === 'expired' ? 'منتهية' : 'تنتهي قريباً'} (${d.license_expiry})`,
      detailEn: `Driver ${d.name_ar} license ${st === 'expired' ? 'expired' : 'expiring'} (${d.license_expiry})`,
    });
  }

  for (const v of (vehiclesRes.data as Vehicle[]) ?? []) {
    if (v.status !== 'active') continue;
    const st = licenseStatus(v.ncwm_license_expiry, 30);
    if (st === 'ok') continue;
    alerts.push({
      key: `vehicle_expiry:${v.id}`,
      severity: st === 'expired' ? 'critical' : 'warning',
      category: 'vehicle_expiry',
      titleAr: 'انتهاء ترخيص مركبة',
      titleEn: 'Vehicle license issue',
      detailAr: `ترخيص NCWM للمركبة ${v.plate_number} ${st === 'expired' ? 'منتهي' : 'ينتهي قريباً'} (${v.ncwm_license_expiry})`,
      detailEn: `Vehicle ${v.plate_number} NCWM license ${st === 'expired' ? 'expired' : 'expiring'} (${v.ncwm_license_expiry})`,
    });
  }

  for (const p of (pickupsRes.data as PickupEvent[]) ?? []) {
    alerts.push({
      key: `non_compliant_pickup:${p.id}`,
      severity: 'critical',
      category: 'non_compliant_pickup',
      titleAr: 'عملية التقاط غير ممتثلة',
      titleEn: 'Non-compliant pickup',
      detailAr: `التقاط بدرجة خطورة ${p.risk_score}/100 بتاريخ ${new Date(p.created_at).toLocaleDateString('ar-SA')}`,
      detailEn: `Pickup with risk ${p.risk_score}/100 on ${new Date(p.created_at).toLocaleDateString('en-CA')}`,
    });
  }

  for (const a of (assignmentsRes.data as PickupAssignment[]) ?? []) {
    alerts.push({
      key: `missed_assignment:${a.id}`,
      severity: 'warning',
      category: 'missed_assignment',
      titleAr: 'مهمة فائتة',
      titleEn: 'Missed assignment',
      detailAr: `مهمة مجدولة بتاريخ ${new Date(a.scheduled_at).toLocaleString('ar-SA')} لم تُقبل`,
      detailEn: `Assignment scheduled ${new Date(a.scheduled_at).toLocaleString('en-CA')} not accepted`,
    });
  }

  const acked = new Set(
    ((acksRes.data as { alert_key: string }[]) ?? []).map((r) => r.alert_key)
  );
  return alerts.filter((a) => !acked.has(a.key));
}

/** Acknowledge an alert so it stops showing for this company. */
export async function acknowledgeAlert(
  companyId: string,
  alertKey: string
): Promise<void> {
  const { error } = await supabase
    .from('alert_acknowledgements')
    .insert({ company_id: companyId, alert_key: alertKey });

  // Ignore unique-violation (already acknowledged)
  if (error && error.code !== '23505') throw error;
}
