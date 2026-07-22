import { useEffect, useState } from 'react';
import { useAuthStore } from '../../stores/authStore';
import { getAlerts, acknowledgeAlert, type DerivedAlert } from '../../lib/api/alerts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { AlertTriangleIcon, XCircleIcon, CheckIcon } from 'lucide-react';

/**
 * Real, derived alerts panel.
 *  - companyId is used both to scope acknowledgements and to enable the
 *    "Acknowledge" button. Transport-only users (no company_id) see alerts
 *    but cannot acknowledge (no company tenant to record the ack against).
 */
export default function RealAlertsPanel({ companyId }: { companyId: string | null }) {
  const { isRTL } = useAuthStore();
  const [alerts, setAlerts] = useState<DerivedAlert[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      setAlerts(await getAlerts(companyId ?? ''));
    } catch {
      setAlerts([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId]);

  async function handleAck(key: string) {
    if (!companyId) return;
    await acknowledgeAlert(companyId, key);
    setAlerts((prev) => prev.filter((a) => a.key !== key));
  }

  return (
    <Card className="bg-card text-card-foreground border-border">
      <CardHeader>
        <CardTitle className="text-foreground flex items-center gap-3">
          <AlertTriangleIcon className="w-6 h-6 text-warning" />
          {isRTL ? 'التنبيهات' : 'Alerts'} ({alerts.length})
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-[500px] pe-4">
          <div className="space-y-4">
            {loading && <div className="text-center py-8 text-muted-foreground">{isRTL ? 'جارٍ التحميل...' : 'Loading...'}</div>}
            {!loading && alerts.length === 0 && (
              <div className="text-center py-12 text-muted-foreground">{isRTL ? 'لا توجد تنبيهات نشطة' : 'No active alerts'}</div>
            )}
            {alerts.map((a) => (
              <Card key={a.key} className={`border-2 ${a.severity === 'critical' ? 'bg-destructive/5 border-destructive/20' : 'bg-warning/5 border-warning/20'}`}>
                <CardContent className="pt-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3">
                      {a.severity === 'critical'
                        ? <XCircleIcon className="w-5 h-5 text-destructive flex-shrink-0 mt-0.5" />
                        : <AlertTriangleIcon className="w-5 h-5 text-warning flex-shrink-0 mt-0.5" />}
                      <div>
                        <h4 className="font-semibold text-foreground">{isRTL ? a.titleAr : a.titleEn}</h4>
                        <p className="text-sm text-muted-foreground mt-1">{isRTL ? a.detailAr : a.detailEn}</p>
                      </div>
                    </div>
                    <Badge variant={a.severity === 'critical' ? 'destructive' : 'secondary'} className="text-xs">
                      {a.severity === 'critical' ? (isRTL ? 'حرج' : 'Critical') : (isRTL ? 'تحذير' : 'Warning')}
                    </Badge>
                  </div>
                  {companyId && (
                    <div className="mt-3 flex justify-end">
                      <Button size="sm" variant="outline" onClick={() => handleAck(a.key)}>
                        <CheckIcon className="w-4 h-4 me-2" />
                        {isRTL ? 'تم الاطلاع' : 'Acknowledge'}
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
