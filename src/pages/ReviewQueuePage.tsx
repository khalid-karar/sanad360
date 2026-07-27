import { useCallback, useEffect, useState } from 'react';
import { useAuthStore } from '../stores/authStore';
import { RiskGauge } from '@/components/ui/risk-gauge';
import { formatDateTime } from '../lib/format';
import AppShell from '../components/AppShell';
import {
  listFlaggedPickups,
  acknowledgePickupReview,
} from '../lib/api/review';
import type { FlaggedRecord } from '../lib/api/review';
import { getSignedUrl } from '../lib/api/storage';
import { generateSinglePickupPdf } from '../lib/api/inspection';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { LoadingState, EmptyState, ErrorState } from '@/components/ui/states';
import {
  Loader2Icon, ImageIcon, PenLineIcon, FileTextIcon, CheckIcon, EyeIcon, ClipboardCheckIcon,
} from 'lucide-react';

const REASON_LABELS: Record<string, { ar: string; en: string }> = {
  missing_photo:            { ar: 'بدون صورة',                 en: 'No photo' },
  missing_signature:        { ar: 'بدون توقيع',                en: 'No signature' },
  geofence_failed:          { ar: 'خارج النطاق الجغرافي',      en: 'Geofence failed' },
  gps_low_accuracy:         { ar: 'دقة موقع منخفضة',           en: 'Low GPS accuracy' },
  qr_mismatch:              { ar: 'رمز QR غير مطابق',          en: 'QR mismatch' },
  qr_token_replayed:        { ar: 'محاولة إعادة استخدام رمز QR', en: 'QR token replayed' },
  possible_relay_attack:    { ar: 'اشتباه بنقل الرمز عن بُعد',  en: 'Possible relay attack' },
  weight_anomaly:           { ar: 'وزن غير معتاد',             en: 'Weight anomaly' },
  driver_license_expiring:  { ar: 'رخصة السائق تنتهي قريباً',  en: 'Driver license expiring' },
  vehicle_license_expiring: { ar: 'رخصة المركبة تنتهي قريباً', en: 'Vehicle license expiring' },
  custody_missing:          { ar: 'بدون تأكيد تسليم',          en: 'Custody not confirmed' },
  qr_skipped_with_reason:   { ar: 'تخطي QR بسبب مُسجَّل',       en: 'QR skipped with reason' },
  reduced_verification:     { ar: 'تحقق مخفَّض (QR إلزامي متخطى)', en: 'Reduced verification' },
  missing_required_evidence: { ar: 'دليل إلزامي مفقود',        en: 'Missing required evidence' },
  // CP7: found rendering raw/untranslated during the review-queue audit —
  // migration 030 (CP5) added this flag but it was never given a label.
  awaiting_branch_confirmation: { ar: 'بانتظار تأكيد الفرع', en: 'Awaiting branch confirmation' },
};

// Per-item labels for the dynamic `missing_required:<item>` flag (022) — one
// entry per evidence_requirements item value.
const REQUIRED_ITEM_LABELS: Record<string, { ar: string; en: string }> = {
  qr:             { ar: 'رمز QR',        en: 'QR code' },
  geofenced_gps:  { ar: 'الموقع الجغرافي', en: 'Geofenced GPS' },
  photo:          { ar: 'الصورة',         en: 'Photo' },
  signature:      { ar: 'التوقيع',        en: 'Signature' },
  receipt:        { ar: 'الإيصال',        en: 'Receipt' },
  scale_photo:    { ar: 'صورة الميزان',    en: 'Scale photo' },
  // CP7: found rendering as the raw item id ("branch_confirmation") during
  // the review-queue audit — migration 026 (CP5) added this required-item
  // value but it was never added here.
  branch_confirmation: { ar: 'تأكيد الفرع', en: 'Branch confirmation' },
};

const MISSING_REQUIRED_PREFIX = 'missing_required:';

/** True for flags that mean "a policy-required item is absent" — these must
 *  read as a distinct, more serious category than an ordinary risk flag,
 *  since they can appear even when risk_score is 0. */
function isPolicyViolationReason(reason: string): boolean {
  return reason === 'missing_required_evidence' || reason.startsWith(MISSING_REQUIRED_PREFIX);
}

function reasonLabel(reason: string, isRTL: boolean): string {
  if (reason.startsWith(MISSING_REQUIRED_PREFIX)) {
    const item = reason.slice(MISSING_REQUIRED_PREFIX.length);
    const itemLabel = REQUIRED_ITEM_LABELS[item]?.[isRTL ? 'ar' : 'en'] ?? item;
    return isRTL ? `مفقود: ${itemLabel}` : `Missing: ${itemLabel}`;
  }
  return (isRTL ? REASON_LABELS[reason]?.ar : REASON_LABELS[reason]?.en) ?? reason;
}

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

  const visible = records.filter((r) => showReviewed || r.needsAttention);
  const pendingCount = records.filter((r) => r.needsAttention).length;

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

        {!loading && error && (
          <ErrorState message={error} retry={reload} retryLabel={isRTL ? 'إعادة المحاولة' : 'Retry'} />
        )}

        {loading ? (
          <LoadingState label={isRTL ? 'جارٍ التحميل' : 'Loading'} />
        ) : error ? null : visible.length === 0 ? (
          <EmptyState
            icon={<ClipboardCheckIcon />}
            title={isRTL ? 'لا توجد عمليات بانتظار المراجعة' : 'Nothing awaiting review'}
            hint={isRTL
              ? 'كل السجلات مراجَعة أو لا تحتاج انتباهاً حالياً'
              : 'Everything is reviewed or doesn’t currently need attention'}
          />
        ) : (
          <div className="space-y-3">
            {visible.map((r) => (
              <Card
                key={r.event.id}
                className={`bg-card text-card-foreground border-border ${!r.needsAttention ? 'opacity-60' : ''}`}
              >
                <CardContent className="pt-6 space-y-3">
                  <div className="flex items-start justify-between flex-wrap gap-3">
                    <div className="flex items-center gap-3">
                      <RiskGauge score={r.event.risk_score} complianceStatus={r.event.compliance_status} isRTL={isRTL} />
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
                          className={
                            isPolicyViolationReason(reason)
                              // Policy violations (a required item is missing) must not
                              // carry the same visual weight as an ordinary risk flag —
                              // this is exactly the "score=0 but non_compliant" case that
                              // must never read as fine.
                              ? 'text-[10px] bg-black text-white border-black dark:bg-white dark:text-black dark:border-white font-semibold'
                              : 'text-[10px]'
                          }
                        >
                          {reasonLabel(reason, isRTL)}
                        </Badge>
                      ))}
                      {r.reviewed && (
                        <Badge variant="outline" className="text-[10px]">
                          {r.custodyConfirmed
                            ? (isRTL ? '✓ مُراجَع' : '✓ Reviewed')
                            // Other flags were acknowledged, but custody is
                            // still open — never claim full "reviewed" here.
                            : (isRTL ? '✓ باقي البنود مُراجَعة' : '✓ Other flags reviewed')}
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
                    {/* Mark Reviewed only ever acknowledges otherReasons — it
                        is never offered as a way to clear custody_missing.
                        A record with ONLY custody_missing gets a disabled,
                        explanatory chip instead; one with other reasons too
                        keeps the normal button for those, independent of
                        custody. */}
                    {r.otherReasons.length > 0 && !r.reviewed && (
                      <Button size="sm" disabled={busyId !== null} onClick={() => acknowledge(r)}>
                        <CheckIcon className="w-4 h-4 me-1" />{isRTL ? 'تمت المراجعة' : 'Mark Reviewed'}
                      </Button>
                    )}
                    {!r.custodyConfirmed && (
                      <Button size="sm" variant="outline" disabled className="cursor-not-allowed opacity-70">
                        <CheckIcon className="w-4 h-4 me-1" />
                        {isRTL ? 'بانتظار تأكيد إعادة التدوير' : 'Awaiting recycler confirmation'}
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
