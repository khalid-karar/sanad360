import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { homeRouteFor } from '../lib/roleRouting';
import AppShell from '../components/AppShell';
import ApplicationDocumentChecklist from '../components/documents/ApplicationDocumentChecklist';
import { fetchMyApplication, submitApplicationForReview } from '../lib/api/applications';
import type { PendingApplication } from '../lib/database.types';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { LoadingState, ErrorState, EmptyState } from '@/components/ui/states';
import { useToast } from '@/hooks/use-toast';
import { ClockIcon, CheckCircle2Icon, XCircleIcon, MailIcon, Loader2Icon, FileTextIcon } from 'lucide-react';

const STATUS_LABEL: Record<string, { ar: string; en: string }> = {
  pending_email_verification: { ar: 'بانتظار تأكيد البريد الإلكتروني', en: 'Awaiting email verification' },
  pending_documents: { ar: 'بانتظار رفع المستندات', en: 'Awaiting documents' },
  pending_review: { ar: 'قيد المراجعة', en: 'Under review' },
  approved: { ar: 'تمت الموافقة', en: 'Approved' },
  rejected: { ar: 'مرفوض', en: 'Rejected' },
};

/**
 * Applicant's ONLY screen (role='applicant'). Every tenant ID is NULL for
 * this role, so this is deliberately not a variant of any tenant dashboard —
 * roleRouting.ts sends every applicant here explicitly, never as a fallback.
 */
export default function ApplicationStatusPage() {
  const { user, isRTL } = useAuthStore();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [application, setApplication] = useState<PendingApplication | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [docsComplete, setDocsComplete] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
    try {
      const app = await fetchMyApplication(user.id);
      setApplication(app);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => { load(); }, [load]);

  async function handleSubmitForReview() {
    if (!application) return;
    setSubmitting(true);
    try {
      await submitApplicationForReview(application.id);
      toast({ title: isRTL ? 'تم الإرسال للمراجعة' : 'Submitted for review' });
      await load();
    } catch (err) {
      toast({
        title: isRTL ? 'تعذر الإرسال' : 'Could not submit',
        description: err instanceof Error ? err.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRefreshAfterApproval() {
    if (!user) return;
    await useAuthStore.getState().hydrate(user.id);
    const refreshed = useAuthStore.getState().user;
    if (refreshed) navigate(homeRouteFor(refreshed));
  }

  return (
    <AppShell role="applicant">
      <div className={`space-y-6 ${isRTL ? 'rtl' : 'ltr'}`}>
        <div>
          <h1 className="text-3xl font-bold text-foreground mb-1">
            {isRTL ? 'حالة الطلب' : 'Application Status'}
          </h1>
          <p className="text-muted-foreground">
            {isRTL ? 'تابع حالة طلب انضمامك هنا' : 'Track your application here'}
          </p>
        </div>

        {error && <ErrorState message={error} retry={load} retryLabel={isRTL ? 'إعادة المحاولة' : 'Retry'} />}

        {loading ? (
          <LoadingState label={isRTL ? 'جارٍ التحميل' : 'Loading'} />
        ) : !application && !error ? (
          <EmptyState
            icon={<FileTextIcon />}
            title={isRTL ? 'لا يوجد طلب مرتبط بحسابك' : 'No application linked to your account'}
          />
        ) : application ? (
          <div className="space-y-6">
            <Card className="bg-card text-card-foreground border-border">
              <CardContent className="pt-6 space-y-3">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <span className="font-medium text-foreground">
                    {isRTL ? application.name_ar : (application.name_en || application.name_ar)}
                  </span>
                  <Badge
                    className={
                      application.status === 'approved' ? 'bg-success text-success-foreground hover:bg-success'
                      : application.status === 'rejected' ? ''
                      : 'bg-warning/15 text-warning'
                    }
                    variant={application.status === 'rejected' ? 'destructive' : undefined}
                  >
                    {isRTL ? STATUS_LABEL[application.status]?.ar : STATUS_LABEL[application.status]?.en}
                  </Badge>
                </div>
              </CardContent>
            </Card>

            {application.status === 'pending_email_verification' && (
              <EmptyState
                icon={<MailIcon />}
                title={isRTL ? 'تحقق من بريدك الإلكتروني' : 'Check your email'}
                hint={isRTL
                  ? 'أرسلنا رابط تأكيد إلى بريدك الإلكتروني. افتحه لمتابعة طلبك.'
                  : 'We sent a verification link to your email. Open it to continue your application.'}
              />
            )}

            {application.status === 'pending_documents' && (
              <div className="space-y-4">
                <ApplicationDocumentChecklist
                  applicationId={application.id}
                  tenantType={application.tenant_type}
                  isRTL={isRTL}
                  onCompletionChange={setDocsComplete}
                />
                <Button
                  onClick={handleSubmitForReview}
                  disabled={!docsComplete || submitting}
                  className="w-full gap-2 bg-primary text-primary-foreground hover:bg-primary/90"
                >
                  {submitting && <Loader2Icon className="w-4 h-4 animate-spin" />}
                  {isRTL ? 'إرسال للمراجعة' : 'Submit for review'}
                </Button>
                {!docsComplete && (
                  <p className="text-sm text-muted-foreground text-center">
                    {isRTL ? 'أكمل رفع جميع المستندات المطلوبة أولاً' : 'Upload all required documents first'}
                  </p>
                )}
              </div>
            )}

            {application.status === 'pending_review' && (
              <EmptyState
                icon={<ClockIcon />}
                title={isRTL ? 'طلبك قيد المراجعة' : 'Your application is under review'}
                hint={isRTL
                  ? 'سيقوم فريقنا بمراجعة طلبك وسنعلمك بالنتيجة عبر البريد الإلكتروني.'
                  : "Our team is reviewing your application — we'll email you the outcome."}
              />
            )}

            {application.status === 'rejected' && (
              <Card className="bg-destructive/5 text-card-foreground border-destructive/30">
                <CardContent className="pt-6 space-y-2" role="alert">
                  <div className="flex items-center gap-2">
                    <XCircleIcon className="w-5 h-5 text-destructive" aria-hidden />
                    <span className="font-medium text-destructive">
                      {isRTL ? 'لم تتم الموافقة على طلبك' : 'Your application was not approved'}
                    </span>
                  </div>
                  {application.reject_reason && (
                    <p className="text-sm text-destructive">
                      {isRTL ? 'السبب: ' : 'Reason: '}{application.reject_reason}
                    </p>
                  )}
                </CardContent>
              </Card>
            )}

            {application.status === 'approved' && (
              <Card className="bg-success/5 text-card-foreground border-success/30">
                <CardContent className="pt-6 space-y-3 text-center">
                  <CheckCircle2Icon className="w-10 h-10 text-success mx-auto" aria-hidden />
                  <p className="font-medium text-foreground">
                    {isRTL ? 'تمت الموافقة على طلبك!' : 'Your application was approved!'}
                  </p>
                  <Button onClick={handleRefreshAfterApproval} className="bg-primary text-primary-foreground hover:bg-primary/90">
                    {isRTL ? 'المتابعة إلى لوحة التحكم' : 'Continue to your dashboard'}
                  </Button>
                </CardContent>
              </Card>
            )}
          </div>
        ) : null}
      </div>
    </AppShell>
  );
}
