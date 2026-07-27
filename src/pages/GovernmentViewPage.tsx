import { useEffect, useState } from 'react';
import { useAuthStore } from '../stores/authStore';
import { govRollup } from '../lib/api/gov';
import type { GovRollupRow } from '../lib/database.types';
import AppShell from '../components/AppShell';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { LoadingState, EmptyState, ErrorState } from '@/components/ui/states';
import { ChevronRightIcon, ChevronLeftIcon, MapPinIcon, LockIcon } from 'lucide-react';

function describeError(e: unknown, isRTL: boolean): string {
  const msg = e instanceof Error ? e.message : String(e ?? '');
  const code = (e as { code?: string } | null)?.code;
  if (code === '42501' || /permission denied|row-level security|not authorized/i.test(msg)) {
    return isRTL ? 'غير مصرح' : 'Not authorized';
  }
  return msg || (isRTL ? 'فشل' : 'Failed');
}

const LEVEL_TITLE: Record<GovRollupRow['level'], { ar: string; en: string }> = {
  region: { ar: 'المناطق', en: 'Regions' },
  industry: { ar: 'القطاعات', en: 'Industries' },
  facility: { ar: 'المنشآت المستقبلة', en: 'Receiving Facilities' },
  transporter: { ar: 'شركات النقل', en: 'Transport Companies' },
};

interface DrillState {
  regionCode: string | null;
  industryCode: string | null;
  facilityId: string | null;
}

const ROOT: DrillState = { regionCode: null, industryCode: null, facilityId: null };

export default function GovernmentViewPage() {
  const { isRTL } = useAuthStore();
  const [drill, setDrill] = useState<DrillState>(ROOT);
  const [trail, setTrail] = useState<{ state: DrillState; label: string }[]>([]);
  const [rows, setRows] = useState<GovRollupRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const insufficientLabel = isRTL ? 'بيانات غير كافية' : 'Insufficient data';

  async function load(state: DrillState) {
    setLoading(true);
    setLoadError(null);
    try {
      setRows(await govRollup(state.regionCode, state.industryCode, state.facilityId));
    } catch (e) {
      setRows([]);
      setLoadError(describeError(e, isRTL));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load(drill);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drill]);

  function drillInto(row: GovRollupRow) {
    if (row.is_suppressed || row.group_key === null) return;
    if (row.level === 'transporter') return; // leaf — nothing further to drill into
    const label = isRTL ? row.label_ar : row.label_en;
    let next: DrillState;
    if (row.level === 'region') next = { ...drill, regionCode: row.group_key };
    else if (row.level === 'industry') next = { ...drill, industryCode: row.group_key };
    else next = { ...drill, facilityId: row.group_key };
    setTrail((t) => [...t, { state: drill, label }]);
    setDrill(next);
  }

  function goToBreadcrumb(index: number) {
    if (index === -1) {
      setTrail([]);
      setDrill(ROOT);
      return;
    }
    setTrail((t) => t.slice(0, index + 1));
    setDrill(trail[index].state);
  }

  const currentLevel: GovRollupRow['level'] =
    drill.facilityId ? 'transporter' : drill.industryCode ? 'facility' : drill.regionCode ? 'industry' : 'region';

  return (
    <AppShell role="gov">
      <div className={`space-y-6 ${isRTL ? 'rtl' : 'ltr'}`}>
        <div>
          <h1 className="text-3xl font-bold text-foreground mb-2">
            {isRTL ? 'الإحصاءات الوطنية للامتثال' : 'National Compliance Statistics'}
          </h1>
          <p className="text-muted-foreground">
            {isRTL
              ? 'إحصاءات مجمّعة فقط — لا تُعرض أي بيانات تعريفية لسائق فردي'
              : 'Aggregated statistics only — no individual driver-level data is ever shown'}
          </p>
        </div>

        {/* Breadcrumb */}
        <nav aria-label={isRTL ? 'مسار التصفح' : 'Breadcrumb'} className="flex items-center gap-1 text-sm flex-wrap">
          <button
            className={`px-2 py-1 rounded-md hover:bg-accent ${trail.length === 0 ? 'font-semibold text-foreground' : 'text-muted-foreground'}`}
            onClick={() => goToBreadcrumb(-1)}
          >
            {isRTL ? 'المناطق' : 'Regions'}
          </button>
          {trail.map((t, i) => (
            <span key={i} className="flex items-center gap-1">
              {isRTL ? <ChevronLeftIcon className="w-4 h-4 text-muted-foreground" aria-hidden="true" /> : <ChevronRightIcon className="w-4 h-4 text-muted-foreground" aria-hidden="true" />}
              <button
                className={`px-2 py-1 rounded-md hover:bg-accent ${i === trail.length - 1 ? 'font-semibold text-foreground' : 'text-muted-foreground'}`}
                onClick={() => goToBreadcrumb(i)}
              >
                {t.label}
              </button>
            </span>
          ))}
        </nav>

        <h2 className="text-lg font-semibold text-foreground">
          {isRTL ? LEVEL_TITLE[currentLevel].ar : LEVEL_TITLE[currentLevel].en}
        </h2>

        {loading && <LoadingState label={isRTL ? 'جارٍ التحميل' : 'Loading'} />}
        {!loading && loadError && (
          <ErrorState message={loadError} retry={() => load(drill)} retryLabel={isRTL ? 'إعادة المحاولة' : 'Retry'} />
        )}
        {!loading && !loadError && rows.length === 0 && (
          <EmptyState
            icon={<MapPinIcon />}
            title={isRTL ? 'لا توجد بيانات' : 'No data'}
            hint={isRTL ? 'لا توجد عمليات التقاط مسجلة ضمن هذا النطاق' : 'No pickups recorded within this scope'}
          />
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {rows.map((row) => {
            const clickable = !row.is_suppressed && row.group_key !== null && row.level !== 'transporter';
            const rowLabel = row.group_key === null
              ? (isRTL ? 'غير مصنّف' : 'Unassigned')
              : (isRTL ? row.label_ar : row.label_en);
            return (
              <Card
                key={row.group_key ?? 'unassigned'}
                className={`border-2 border-border ${clickable ? 'cursor-pointer hover:border-primary/40 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background' : ''}`}
                onClick={() => clickable && drillInto(row)}
                role={clickable ? 'button' : undefined}
                tabIndex={clickable ? 0 : undefined}
                aria-label={clickable ? (isRTL ? `عرض تفاصيل ${rowLabel}` : `View details for ${rowLabel}`) : undefined}
                onKeyDown={clickable ? (e) => {
                  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); drillInto(row); }
                } : undefined}
              >
                <CardContent className="pt-6 space-y-4">
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="font-semibold text-foreground text-lg">
                        {rowLabel}
                      </h3>
                    </div>
                    {row.is_suppressed && (
                      <Badge variant="secondary" className="flex items-center gap-1">
                        <LockIcon className="w-3 h-3" aria-hidden="true" />
                        {isRTL ? 'محمي' : 'Protected'}
                      </Badge>
                    )}
                  </div>

                  {row.is_suppressed ? (
                    <div className="rounded-lg bg-muted p-3 flex items-center gap-2" role="status">
                      <LockIcon className="w-4 h-4 text-muted-foreground flex-shrink-0" aria-hidden="true" />
                      <p className="text-sm font-medium text-foreground">{insufficientLabel}</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <p className="text-xs text-muted-foreground">{isRTL ? 'عدد المنشآت' : 'Companies'}</p>
                        <p className="text-lg font-semibold text-foreground">{row.n_companies}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">{isRTL ? 'عمليات الالتقاط' : 'Pickups'}</p>
                        <p className="text-lg font-semibold text-foreground">{row.total_pickups}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">{isRTL ? 'ممتثل' : 'Compliant'}</p>
                        <p className="text-lg font-semibold text-success">{row.compliant_count}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">{isRTL ? 'غير ممتثل' : 'Non-Compliant'}</p>
                        <p className="text-lg font-semibold text-destructive">{row.non_compliant_count}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">{isRTL ? 'تحذير' : 'Warning'}</p>
                        <p className="text-lg font-semibold text-warning">{row.warning_count}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">{isRTL ? 'بانتظار تأكيد الفرع' : 'Pending Confirmation'}</p>
                        <p className="text-lg font-semibold text-secondary-foreground">{row.pending_confirmation_count}</p>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </AppShell>
  );
}
