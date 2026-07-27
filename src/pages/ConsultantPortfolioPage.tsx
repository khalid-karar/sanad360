import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { listConsultantEngagements, type ConsultantEngagement } from '../lib/api/consultant';
import { homeRouteFor } from '../lib/roleRouting';
import AppShell from '../components/AppShell';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { LoadingState, EmptyState, ErrorState } from '@/components/ui/states';
import { Building2Icon, ArrowRightIcon } from 'lucide-react';

function describeError(e: unknown, isRTL: boolean): string {
  const msg = e instanceof Error ? e.message : String(e ?? '');
  return msg || (isRTL ? 'فشل' : 'Failed');
}

export default function ConsultantPortfolioPage() {
  const { isRTL, user, switchTenant } = useAuthStore();
  const navigate = useNavigate();
  const [engagements, setEngagements] = useState<ConsultantEngagement[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [switching, setSwitching] = useState<string | null>(null);

  async function load() {
    if (!user?.id) return;
    setLoading(true);
    setLoadError(null);
    try {
      setEngagements(await listConsultantEngagements(user.id));
    } catch (e) {
      setEngagements([]);
      setLoadError(describeError(e, isRTL));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  async function openEngagement(membershipId: string) {
    setSwitching(membershipId);
    try {
      await switchTenant(membershipId);
      const next = useAuthStore.getState().user;
      navigate(next ? homeRouteFor(next) : '/login');
    } finally {
      setSwitching(null);
    }
  }

  return (
    <AppShell role="consultant">
      <div className={`space-y-8 ${isRTL ? 'rtl' : 'ltr'}`}>
        <div>
          <h1 className="text-3xl font-bold text-foreground mb-2">
            {isRTL ? 'محفظة العملاء' : 'Client Portfolio'}
          </h1>
          <p className="text-muted-foreground">
            {isRTL
              ? 'المنشآت التي تقدّم لها الاستشارة. افتح منشأة للاطلاع على بياناتها الفعلية.'
              : 'Companies you consult for. Open one to view its real data.'}
          </p>
        </div>

        {loading && <LoadingState label={isRTL ? 'جارٍ التحميل' : 'Loading'} />}
        {!loading && loadError && (
          <ErrorState message={loadError} retry={load} retryLabel={isRTL ? 'إعادة المحاولة' : 'Retry'} />
        )}
        {!loading && !loadError && engagements.length === 0 && (
          <EmptyState
            icon={<Building2Icon />}
            title={isRTL ? 'لا توجد منشآت مرتبطة بعد' : 'No engaged companies yet'}
            hint={isRTL
              ? 'سيظهر هنا كل منشأة تمت إضافتك إليها كمستشار'
              : 'Every company you\'re added to as a consultant will appear here'}
          />
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {engagements.map((e) => (
            <Card key={e.membership.id} className="border-2 border-border">
              <CardContent className="pt-6 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                    <Building2Icon className="w-5 h-5 text-primary" />
                  </div>
                  <p className="font-semibold text-foreground">
                    {e.companyName ?? (isRTL ? 'منشأة' : 'Company')}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={switching === e.membership.id}
                  aria-busy={switching === e.membership.id}
                  onClick={() => openEngagement(e.membership.id)}
                >
                  {isRTL ? 'فتح' : 'Open'}
                  <ArrowRightIcon className={`w-4 h-4 ${isRTL ? 'me-2 rotate-180' : 'ms-2'}`} />
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </AppShell>
  );
}
