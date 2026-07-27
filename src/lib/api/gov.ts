import { supabase } from '../supabase';
import type { GovRollupRow } from '../database.types';

/**
 * The ENTIRE gov_viewer data-access surface (migration 031) — region →
 * industry → facility → transporter drill-down, one level at a time. Every
 * call is server-side k-anonymized (default min 5 companies) with
 * complementary suppression against differencing; a suppressed row's
 * numeric fields come back NULL, never 0, never omitted — the UI must
 * render that as "insufficient data," never as a silent zero.
 */
export async function govRollup(
  regionCode: string | null = null,
  industryCode: string | null = null,
  facilityId: string | null = null
): Promise<GovRollupRow[]> {
  const { data, error } = await supabase.rpc('gov_rollup', {
    p_region_code: regionCode,
    p_industry_code: industryCode,
    p_facility_id: facilityId,
  });
  if (error) throw error;
  return data ?? [];
}
