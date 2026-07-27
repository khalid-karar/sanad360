import { useCallback, useEffect, useState } from 'react';
import { useAuthStore } from '../stores/authStore';
import AppShell from '../components/AppShell';
import {
  listApplicationsPendingReview, reviewApplication, notifyApplicationDecision,
} from '../lib/api/applications';
import type { PendingApplication } from '../lib/database.types';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { CheckCircle2Icon, XCircleIcon, Loader2Icon, MailWarningIcon } from 'lucide-react';
import { LoadingState, EmptyState, ErrorState } from '@/components/ui/states';
import { Modal } from '@/components/ui/modal';

const TENANT_TYPE_LABEL: Record<string, { ar: string; en: string }> = {
  company: { ar: 'منشأة', en: 'Company' },
  transport_company: { ar: 'شركة نقل', en: 'Transport Co.' },
};

interface RecentDecision {
  applicationId: string;
  name: string;
  decision: 'approved' | 'rejected';
  notifySent: boolean;
}

/**
 * Application review queue (document_reviewer / system_admin / admin /
 * super_admin — mirrors review_pending_application()'s own role gate).
 * Distinct from DocumentReviewQueuePage (which reviews individual uploaded
 * documents) but follows the same shape: load(), busyId-scoped actions, a
 * mandatory-reason modal for rejection.
 *
 * Approve/reject calls review_pending_application() directly (the RPC is the
 * decision of record); ONLY on that RPC's success do we call
 * /admin/notify-application-decision. A failed notify does NOT roll back or
 * re-call the RPC — the decision already committed — it just surfaces a
 * non-blocking "resend" affordance in the Recent Decisions list below.
 */
export default function ApplicationReviewQueuePage() {
  const { isRTL } = useAuthStore();
  const { toast } = useToast();

  const [rows, setRows] = useState<PendingApplication[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [rejecting, setRejecting] = useState<PendingApplication | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const [recentDecisions, setRecentDecisions] = useState<RecentDecision[]>([]);
  const [resendingId, setResendingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRows(await listApplicationsPendingReview());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function recordDecision(app: PendingApplication, decision: 'approved' | 'rejected') {
    const name = app.name_en || app.name_ar;
    try {
      const result = await notifyApplicationDecision(app.id);
      setRecentDecisions((prev) => [{ applicationId: app.id, name, decision, notifySent: result.sent }, ...prev]);
      if (!result.sent) {
        toast({
          title: isRTL ? 'تم حفظ القرار — تعذر إرسال البريد' : 'Decision saved — email not sent',
          description: isRTL ? 'يمكنك إعادة المحاولة أدناه' : 'You can retry sending it below',
        });
      }
    } catch {
      setRecentDecisions((prev) => [{ applicationId: app.id, name, decision, notifySent: false }, ...prev]);
      toast({
        title: isRTL ? 'تم حفظ القرار — تعذر إرسال البريد' : 'Decision saved — email not sent',
        description: isRTL ? 'يمكنك إعادة المحاولة أدناه' : 'You can retry sending it below',
      });
    }
  }

  async function handleApprove(app: PendingApplication) {
    setBusyId(app.id);
    try {
      await reviewApplication(app.id, 'approved');
      toast({ title: isRTL ? 'تمت الموافقة' : 'Approved' });
      await recordDecision(app, 'approved');
      await load();
    } catch (err) {
      toast({ title: isRTL ? 'فشل' : 'Failed', description: err instanceof Error ? err.message : undefined, variant: 'destructive' });
    } finally {
      setBusyId(null);
    }
  }

  async function handleReject() {
    if (!rejecting || !rejectReason.trim()) return;
    const app = rejecting;
    setBusyId(app.id);
    try {
      await reviewApplication(app.id, 'rejected', rejectReason.trim());
      toast({ title: isRTL ? 'تم الرفض' : 'Rejected' });
      setRejecting(null);
      setRejectReason('');
      await recordDecision(app, 'rejected');
      await load();
    } catch (err) {
      toast({ title: isRTL ? 'فشل' : 'Failed', description: err instanceof Error ? err.message : undefined, variant: 'destructive' });
    } finally {
      setBusyId(null);
    }
  }

  async function handleResend(applicationId: string) {
    setResendingId(applicationId);
    try {
      const result = await notifyApplicationDecision(applicationId);
      setRecentDecisions((prev) =>
        prev.map((d) => (d.applicationId === applicationId ? { ...d, notifySent: result.sent } : d))
      );
      toast({ title: result.sent ? (isRTL ? 'تم الإرسال' : 'Sent') : (isRTL ? 'ما زال الإرسال متعذراً' : 'Still could not send') });
    } catch (err) {
      toast({ title: isRTL ? 'فشل الإرسال' : 'Send failed', description: err instanceof Error ? err.message : undefined, variant: 'destructive' });
    } finally {
      setResendingId(null);
    }
  }

  return (
    <AppShell role="reviewer">
      <div className={`space-y-6 ${isRTL ? 'rtl' : 'ltr'}`}>
        <div>
          <h1 className="text-3xl font-bold text-foreground mb-1">
            {isRTL ? 'قائمة مراجعة الطلبات' : 'Applications Review Queue'}
          </h1>
          <p className="text-muted-foreground">
            {isRTL ? 'الموافقة أو رفض طلبات الانضمام قيد المراجعة' : 'Approve or reject applications awaiting review'}
          </p>
        </div>

        {error && <ErrorState message={error} retry={load} retryLabel={isRTL ? 'إعادة المحاولة' : 'Retry'} />}

        {loading ? (
          <LoadingState label={isRTL ? 'جارٍ التحميل' : 'Loading'} />
        ) : rows.length === 0 && !error ? (
          <EmptyState title={isRTL ? 'لا توجد طلبات بانتظار المراجعة' : 'No applications awaiting review'} />
        ) : (
          <div className="space-y-3">
            {rows.map((app) => (
              <Card key={app.id} data-testid={`application-review-row-${app.id}`} className="bg-card text-card-foreground border-border">
                <CardContent className="pt-6 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary">
                        {isRTL ? TENANT_TYPE_LABEL[app.tenant_type]?.ar : TENANT_TYPE_LABEL[app.tenant_type]?.en}
                      </Badge>
                      <span className="font-medium text-foreground">{isRTL ? app.name_ar : (app.name_en || app.name_ar)}</span>
                    </div>
                    <p className="text-sm text-muted-foreground mt-1" dir="ltr">{app.commercial_registration}</p>
                    <p className="text-xs text-muted-foreground" dir="ltr">{app.contact_email}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      className="gap-1 bg-success text-success-foreground hover:bg-success/90"
                      disabled={busyId === app.id}
                      aria-busy={busyId === app.id}
                      onClick={() => handleApprove(app)}
                    >
                      {busyId === app.id ? <Loader2Icon className="w-4 h-4 animate-spin" /> : <CheckCircle2Icon className="w-4 h-4" />}
                      {isRTL ? 'موافقة' : 'Approve'}
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      className="gap-1"
                      disabled={busyId === app.id}
                      onClick={() => { setRejecting(app); setRejectReason(''); }}
                    >
                      <XCircleIcon className="w-4 h-4" />
                      {isRTL ? 'رفض' : 'Reject'}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {recentDecisions.length > 0 && (
          <div className="space-y-3">
            <h2 className="text-lg font-semibold text-foreground">
              {isRTL ? 'القرارات الأخيرة' : 'Recent Decisions'}
            </h2>
            {recentDecisions.map((d) => (
              <Card key={d.applicationId} className="bg-card text-card-foreground border-border">
                <CardContent className="pt-4 pb-4 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <Badge className={d.decision === 'approved' ? 'bg-success text-success-foreground hover:bg-success' : ''} variant={d.decision === 'rejected' ? 'destructive' : undefined}>
                      {d.decision === 'approved' ? (isRTL ? 'تمت الموافقة' : 'Approved') : (isRTL ? 'مرفوض' : 'Rejected')}
                    </Badge>
                    <span className="text-sm text-foreground">{d.name}</span>
                  </div>
                  {d.notifySent ? (
                    <span className="text-xs text-muted-foreground">{isRTL ? 'تم إرسال البريد' : 'Email sent'}</span>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1"
                      disabled={resendingId === d.applicationId}
                      onClick={() => handleResend(d.applicationId)}
                    >
                      {resendingId === d.applicationId
                        ? <Loader2Icon className="w-4 h-4 animate-spin" />
                        : <MailWarningIcon className="w-4 h-4" />}
                      {isRTL ? 'إعادة إرسال البريد' : 'Resend email'}
                    </Button>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {rejecting && (
        <Modal open onClose={() => setRejecting(null)} isRTL={isRTL} title={isRTL ? 'سبب الرفض' : 'Reject Reason'}>
          <div className="space-y-4">
            <Label className="text-foreground" htmlFor="app-reject-reason">{isRTL ? 'السبب (إلزامي)' : 'Reason (required)'} *</Label>
            <Input id="app-reject-reason" value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} className="bg-background text-foreground border-input" />
            <div className="flex gap-3">
              <Button variant="destructive" disabled={!rejectReason.trim() || busyId === rejecting.id} aria-busy={busyId === rejecting.id} onClick={handleReject} className="gap-2">
                {busyId === rejecting.id && <Loader2Icon className="w-4 h-4 animate-spin" />}
                {isRTL ? 'تأكيد الرفض' : 'Confirm Reject'}
              </Button>
              <Button variant="outline" onClick={() => setRejecting(null)}>{isRTL ? 'إلغاء' : 'Cancel'}</Button>
            </div>
          </div>
        </Modal>
      )}
    </AppShell>
  );
}
