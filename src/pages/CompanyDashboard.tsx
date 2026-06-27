import { useEffect, useState } from 'react';
import { useAuthStore } from '../stores/authStore';
import { useCompanyStore } from '../stores/companyStore';
import { generateMonthlyPdf } from '../lib/api/inspection';
import AppShell from '../components/AppShell';
import ComplianceWidget from '../components/company/ComplianceWidget';
import RecentPickups from '../components/company/RecentPickups';
import WastePerformance from '../components/company/WastePerformance';
import InspectionPdfsList from '../components/company/InspectionPdfsList';
import PageTransition from '../components/animations/PageTransition';
import FadeInUp from '../components/animations/FadeInUp';
import StaggeredList from '../components/animations/StaggeredList';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { FileTextIcon, Loader2Icon } from 'lucide-react';

// Default to current year-month in Asia/Riyadh
function currentMonth(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Riyadh' }).substring(0, 7);
}

export default function CompanyDashboard() {
  const { isRTL, user } = useAuthStore();
  const { complianceData, recentPickups, loadRecentPickups } = useCompanyStore();

  const [selectedMonth, setSelectedMonth] = useState(currentMonth());
  const [generatingMonthly, setGeneratingMonthly] = useState(false);
  const [monthlyError, setMonthlyError] = useState<string | null>(null);

  useEffect(() => {
    loadRecentPickups();
  }, [loadRecentPickups]);

  async function handleGenerateMonthly() {
    if (!user?.branch_id) {
      setMonthlyError(isRTL ? 'لم يتم تحديد الفرع.' : 'No branch assigned to your account.');
      return;
    }
    setGeneratingMonthly(true);
    setMonthlyError(null);
    try {
      const result = await generateMonthlyPdf(user.branch_id, selectedMonth);
      window.open(result.signed_url, '_blank', 'noopener');
    } catch (err) {
      setMonthlyError(err instanceof Error ? err.message : 'فشل إنشاء التقرير');
    } finally {
      setGeneratingMonthly(false);
    }
  }

  return (
    <AppShell role="company">
      <PageTransition>
        <div className={`section-spacing ${isRTL ? 'rtl' : 'ltr'}`}>
          <FadeInUp>
            <div>
              <h1 className="text-display text-foreground mb-3">
                {isRTL ? 'لوحة التحكم' : 'Dashboard'}
              </h1>
              <p className="text-body text-muted-foreground">
                {isRTL ? 'مرحباً بك في نظام إدارة النفايات' : 'Welcome to Waste Management System'}
              </p>
            </div>
          </FadeInUp>

          <FadeInUp delay={0.2}>
            <ComplianceWidget data={complianceData} />
          </FadeInUp>

          {/* Monthly Inspection Report */}
          <FadeInUp delay={0.3}>
            <Card className="bg-card text-card-foreground border-border">
              <CardHeader className="flex flex-row items-center gap-2">
                <FileTextIcon className="w-5 h-5 text-primary" />
                <CardTitle>
                  {isRTL ? 'التقرير الشهري للتفتيش' : 'Monthly Inspection Report'}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground mb-4">
                  {isRTL
                    ? 'أنشئ ملف تفتيش شهرياً يتضمن جميع عمليات نقل النفايات خلال الشهر المحدد.'
                    : 'Generate a monthly inspection file covering all waste transfers in the selected month.'}
                </p>
                <div className="flex items-center gap-3 flex-wrap">
                  <input
                    type="month"
                    value={selectedMonth}
                    onChange={(e) => setSelectedMonth(e.target.value)}
                    max={currentMonth()}
                    className="border border-border rounded-md px-3 py-1.5 text-sm bg-background text-foreground"
                    dir="ltr"
                  />
                  <Button
                    onClick={handleGenerateMonthly}
                    disabled={generatingMonthly}
                    className="gap-2"
                  >
                    {generatingMonthly
                      ? <Loader2Icon className="w-4 h-4 animate-spin" />
                      : <FileTextIcon className="w-4 h-4" />}
                    {isRTL ? 'إنشاء التقرير الشهري' : 'Generate Monthly Report'}
                  </Button>
                </div>
                {monthlyError && (
                  <p className="text-sm text-destructive mt-2">{monthlyError}</p>
                )}
              </CardContent>
            </Card>
          </FadeInUp>

          <StaggeredList staggerDelay={0.1}>
            {[
              <RecentPickups key="pickups" pickups={recentPickups} />,
              <WastePerformance key="performance" />,
              <InspectionPdfsList key="pdfs" />,
            ]}
          </StaggeredList>
        </div>
      </PageTransition>
    </AppShell>
  );
}
