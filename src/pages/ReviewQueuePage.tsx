import { useCallback, useEffect, useState } from 'react';
import { useAuthStore } from '../stores/authStore';
import { RiskGauge } from '@/components/ui/risk-gauge';
import { formatDateTime } from '../lib/format';
import AppShell from '../components/AppShell';
import {
  listFlaggedPickups,
  acknowledgePickupReview,
} from '../lib/api/review';
import type { FlaggedRecord, ReviewReason } from '../lib/api/review';
import { getSignedUrl } from '../lib/api/storage';
import { generateSinglePickupPdf } from '../lib/api/inspection';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import {
  Loader2Icon, ImageIcon, PenLineIcon, FileTextIcon, CheckIcon, EyeIcon,
} from 'lucide-react';

const REASON_LABELS: Record<ReviewReason, { ar: string; en: string }> = {
  missing_photo:            { ar: 'بدون صورة',                 en: 'No photo' },
  missing_signature:        { ar: 'بدون توقيع',                en: 'No signature' },
  geofence_failed:          { ar: 'خارج النطاق الجغرافي',      en: 'Geofence failed' },
  gps_low_accuracy:         { ar: 'دقة موقع منخفضة',           en: 'Low GPS accuracy' },
  qr_mismatch:              { ar: 'رمز QR غير مطابق',          en: 'QR mismatch' },
  weight_anomaly:           { ar: 'وزن غير معتاد',             en: 'Weight anomaly' },
  driver_license_expiring:  { ar: 'رخصة السائق تنتهي قريباً',  en: 'Driver license expiring' },
  vehicle_license_expiring: { ar: 'رخصة المركبة تنتهي قريباً', en: 'Vehicle license expiring' },
  custody_missing:          { ar: 'بدون تأكيد تسليم',          en: 'Custody not confirmed' },
};

/**
 * Manager review queue: every pickup the server flagged (risk engine) or whose
 * chain of custody is still open, with its evidence one click away and an
 * acknowledge action so the branch stays inspection-ready.
 */
export default function ReviewQueuePage() {
  const { isRTL, user } = useAuthStore();
  const { toast } = useToast();

  const [records, setRecords] = useState<FlaggedRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [showReviewed, setShowReviewed] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRecords(await listFlaggedPickups());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  async function openEvidence(bucket: string, path: string) {
    try {
      const url = await getSignedUrl(bucket, path, 300);
      window.open(url, '_blank');
    } catch (err) {
      toast({
        title: isRTL ? 'خطأ' : 'Error',
        description: err instanceof Error ? err.message : 'Failed',
        variant: 'destructive',
      });
    }
  }

  async function openPdf(eventId: string) {
    setBusyId(eventId);
    try {
      const result = await generateSinglePickupPdf(eventId);
      window.open(result.signed_url, '_blank');
    } catch (err) {
      toast({
        title: isRTL ? 'خطأ' : 'Error',
        description: err instanceof Error ? err.message : 'Failed',
        variant: 'destructive',
      });
    } finally {
      setBusyId(null);
    }
  }

  async function acknowledge(r: FlaggedRecord) {
    if (!user?.company_id) return;
    setBusyId(r.event.id);
    try {
      await acknowledgePickupReview(user.company_id, r.event.id, user.id);
      setRecords((prev) =>
        prev.map((x) => (x.event.id === r.event.id ? { ...x, reviewed: true } : x))
      );
      toast({ title: isRTL ? 'تم' : 'Done', description: isRTL ? 'تمت المراجعة' : 'Marked as reviewed' });
    } catch (err) {
      toast({
        title: isRTL ? 'خطأ' : 'Error',
        description: err instanceof Error ? err.message : 'Failed',
        variant: 'destructive',
      });
    } finally {
      setBusyId(null);
    }
  }

  const visible = records.filter((r) => showReviewed || !r.reviewed);
  const pendingCount = records.filter((r) => !r.reviewed).length;

  return (
    <AppShell role="company">
      <div className={`space-y-6 ${isRTL ? 'rtl' : 'ltr'}`}>
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-3xl font-bold text-foreground mb-1">
              {isRTL ? 'قائمة المراجعة' : 'Review Queue'}
            </h1>
            <p className="text-muted-foreground">
              {isRTL
                ? `عمليات تحتاج انتباهك (${pendingCount})`
                : `Records needing attention (${pendingCount})`}
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => setShowReviewed((v) => !v)}>
            <EyeIcon className="w-4 h-4 me-2" />
            {showReviewed
              ? (isRTL ? 'إخفاء المُراجَع' : 'Hide reviewed')
              : (isRTL ? 'إظهار المُراجَع' : 'Show reviewed')}
          </Button>
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        {loading ? (
          <div className="flex justify-center py-10">
            <Loader2Icon className="w-6 h-6 animate-spin text-primary" />
          </div>
        ) : visible.length === 0 ? (
          <Card className="bg-card text-card-foreground border-border">
            <CardContent className="pt-8 pb-8 text-center text-muted-foreground">
              {isRTL ? '✓ لا توجد عمليات بانتظار المراجعة' : '✓ Nothing awaiting review'}
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {visible.map((r) => (
              <Card
                key={r.event.id}
                className={`bg-card text-card-foreground border-border ${r.reviewed ? 'opacity-60' : ''}`}
              >
                <CardContent className="pt-6 space-y-3">
                  <div className="flex items-start justify-between flex-wrap gap-3">
                    <div className="flex items-center gap-3">
                      <RiskGauge score={r.event.risk_score} />
                      <div>
                        <p className="text-sm text-foreground" dir="ltr">
                          {formatDateTime(r.event.created_at, isRTL)}
                        </p>
                        <p className="text-xs text-muted-foreground mt-1" dir="ltr">
                          {r.event.weight_kg} kg
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-1 justify-end max-w-[60%]">
                      {r.reasons.map((reason) => (
                        <Badge
                          key={reason}
                          variant={reason === 'custody_missing' ? 'secondary' : 'destructive'}
                          className="text-[10px]"
                        >
                          {isRTL ? REASON_LABELS[reason]?.ar ?? reason : REASON_LABELS[reason]?.en ?? reason}
                        </Badge>
                      ))}
                      {r.reviewed && (
                        <Badge variant="outline" className="text-[10px]">
                          {isRTL ? '✓ مُراجَع' : '✓ Reviewed'}
                        </Badge>
                      )}
                    </div>
                  </div>

                  <div className="flex gap-2 flex-wrap pt-1 border-t border-border">
                    {r.event.photo_path && (
                      <Button size="sm" variant="outline" onClick={() => openEvidence('pickup-photos', r.event.photo_path!)}>
                        <ImageIcon className="w-4 h-4 me-1" />{isRTL ? 'الصورة' : 'Photo'}
                      </Button>
                    )}
                    {r.event.signature_path && (
                      <Button size="sm" variant="outline" onClick={() => openEvidence('pickup-signatures', r.event.signature_path!)}>
                        <PenLineIcon className="w-4 h-4 me-1" />{isRTL ? 'التوقيع' : 'Signature'}
                      </Button>
                    )}
                    <Button size="sm" variant="outline" disabled={busyId !== null} onClick={() => openPdf(r.event.id)}>
                      {busyId === r.event.id
                        ? <Loader2Icon className="w-4 h-4 animate-spin me-1" />
                        : <FileTextIcon className="w-4 h-4 me-1" />}
                      {isRTL ? 'ملف التفتيش' : 'Inspection PDF'}
                    </Button>
                    {!r.reviewed && (
                      <Button size="sm" disabled={busyId !== null} onClick={() => acknowledge(r)}>
                        <CheckIcon className="w-4 h-4 me-1" />{isRTL ? 'تمت المراجعة' : 'Mark Reviewed'}
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
