import { supabase } from '../supabase';
import type { PickupEvent } from '../database.types';

export interface WeekPoint {
  weekStart: string;   // ISO date of the week's Sunday
  total: number;
  compliant: number;
}

export interface DashboardKpis {
  totalPickups: number;
  totalWeightKg: number;
  compliantCount: number;
  warningCount: number;
  nonCompliantCount: number;
  complianceRate: number;       // 0..100, % compliant of total
  trendByWeek: WeekPoint[];
}

export interface DateRange {
  from?: string;   // ISO date
  to?: string;     // ISO date
}

function weekStart(d: Date): string {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - x.getDay()); // back to Sunday
  return x.toISOString().substring(0, 10);
}

/**
 * Compute KPIs for a company over a date range (default: last 30 days).
 * Reads latest revision per logical event via the RLS-enforced view.
 */
export async function getDashboardKpis(
  companyId: string,
  range: DateRange = {}
): Promise<DashboardKpis> {
  const to = range.to ?? new Date().toISOString().substring(0, 10);
  const from =
    range.from ??
    new Date(Date.now() - 30 * 86400000).toISOString().substring(0, 10);

  const { data, error } = await supabase
    .from('pickup_events_latest')
    .select('weight_kg, compliance_status, created_at')
    .eq('company_id', companyId)
    .gte('created_at', from)
    .lte('created_at', to + 'T23:59:59Z');

  if (error) throw error;

  const rows = (data as Pick<
    PickupEvent,
    'weight_kg' | 'compliance_status' | 'created_at'
  >[]) ?? [];

  let totalWeightKg = 0;
  let compliantCount = 0;
  let warningCount = 0;
  let nonCompliantCount = 0;
  const weekMap = new Map<string, WeekPoint>();

  for (const r of rows) {
    totalWeightKg += Number(r.weight_kg) || 0;
    if (r.compliance_status === 'compliant') compliantCount++;
    else if (r.compliance_status === 'warning') warningCount++;
    else if (r.compliance_status === 'non_compliant') nonCompliantCount++;

    const wk = weekStart(new Date(r.created_at));
    const point = weekMap.get(wk) ?? { weekStart: wk, total: 0, compliant: 0 };
    point.total++;
    if (r.compliance_status === 'compliant') point.compliant++;
    weekMap.set(wk, point);
  }

  const totalPickups = rows.length;
  const complianceRate =
    totalPickups === 0 ? 0 : Math.round((compliantCount / totalPickups) * 100);

  const trendByWeek = Array.from(weekMap.values()).sort((a, b) =>
    a.weekStart.localeCompare(b.weekStart)
  );

  return {
    totalPickups,
    totalWeightKg: Math.round(totalWeightKg * 100) / 100,
    compliantCount,
    warningCount,
    nonCompliantCount,
    complianceRate,
    trendByWeek,
  };
}
