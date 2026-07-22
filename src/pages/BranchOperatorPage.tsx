import { useEffect, useRef, useState } from 'react';
import { useAuthStore } from '../stores/authStore';
import { listPendingConfirmations, confirmPickup, disputePickup } from '../lib/api/pickupConfirmations';
import { requestBranchQrToken } from '../lib/api/branches';
import type { PickupEvent } from '../lib/database.types';
import AppShell from '../components/AppShell';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { LoadingState, EmptyState, ErrorState } from '@/components/ui/states';
import { Modal } from '@/components/ui/modal';
import { useToast } from '@/hooks/use-toast';
import { QrCodeIcon, CheckCircle2Icon, XCircleIcon, ClockIcon } from 'lucide-react';
import QRCode from 'qrcode';

function describeError(e: unknown, isRTL: boolean): string {
  const msg = e instanceof Error ? e.message : String(e ?? '');
  const code = (e as { code?: string } | null)?.code;
  if (code === '42501' || /permission denied|row-level security|not authorized/i.test(msg)) {
    return isRTL ? 'غير مصرح' : 'Not authorized';
  }
  return msg || (isRTL ? 'فشل' : 'Failed');
}

const QR_REFRESH_MARGIN_MS = 20_000;

export default function BranchOperatorPage() {
  const { isRTL, user } = useAuthStore();
  const { toast } = useToast();
  const branchId = user?.branch_id ?? null;

  const [pickups, setPickups] = useState<PickupEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [disputing, setDisputing] = useState<PickupEvent | null>(null);
  const [disputeReason, setDisputeReason] = useState('');

  // Rotating branch QR — same refresh pattern as BranchesPage.tsx, scoped to
  // this operator's own single branch (there's exactly one to show; no list
  // or picker needed).
  const [showQr, setShowQr] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [qrError, setQrError] = useState<string | null>(null);
  const qrRefreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function clearQrRefresh() {
    if (qrRefreshTimer.current) {
      clearTimeout(qrRefreshTimer.current);
      qrRefreshTimer.current = null;
    }
  }

  async function refreshQr() {
    if (!branchId) return;
    try {
      const { token, expires_at } = await requestBranchQrToken(branchId);
      const dataUrl = await QRCode.toDataURL(token, { width: 480, margin: 2 });
      setQrDataUrl(dataUrl);
      setQrError(null);
      const msUntilExpiry = new Date(expires_at).getTime() - Date.now();
      const delay = Math.max(msUntilExpiry - QR_REFRESH_MARGIN_MS, 5_000);
      qrRefreshTimer.current = setTimeout(refreshQr, delay);
    } catch (e) {
      setQrError(describeError(e, isRTL));
      qrRefreshTimer.current = setTimeout(refreshQr, 5_000);
    }
  }

  function openQr() {
    setShowQr(true);
    setQrDataUrl(null);
    setQrError(null);
    void refreshQr();
  }

  function closeQr() {
    clearQrRefresh();
    setShowQr(false);
    setQrDataUrl(null);
    setQrError(null);
  }

  useEffect(() => {
    if (!showQr) return;
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refreshQr();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showQr]);

  useEffect(() => () => clearQrRefresh(), []);

  async function load() {
    if (!branchId) return;
    setLoading(true);
    setLoadError(null);
    try {
      setPickups(await listPendingConfirmations(branchId));
    } catch (e) {
      setPickups([]);
      setLoadError(describeError(e, isRTL));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchId]);

  async function handleConfirm(pickup: PickupEvent) {
    setBusyId(pickup.id);
    try {
      let gps: GeolocationCoordinates | null = null;
      try {
        const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
          navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 5000 })
        );
        gps = pos.coords;
      } catch {
        // GPS is optional here — in_app_confirm is sufficient on its own
        // (confirmation_method_policy default); location just enriches it.
      }
      await confirmPickup(pickup.id, gps
        ? { gps_lat: gps.latitude, gps_lng: gps.longitude, gps_accuracy_m: gps.accuracy }
        : {});
      await load();
      toast({ title: isRTL ? 'تم التأكيد' : 'Confirmed', description: isRTL ? 'تم تأكيد استلام النفايات' : 'Pickup confirmed' });
    } catch (e) {
      toast({ title: isRTL ? 'خطأ' : 'Error', description: describeError(e, isRTL), variant: 'destructive' });
    } finally {
      setBusyId(null);
    }
  }

  function openDispute(pickup: PickupEvent) {
    setDisputing(pickup);
    setDisputeReason('');
  }

  async function handleDisputeSubmit() {
    if (!disputing || !disputeReason.trim()) return;
    setBusyId(disputing.id);
    try {
      await disputePickup(disputing.id, disputeReason.trim());
      setDisputing(null);
      await load();
      toast({ title: isRTL ? 'تم' : 'Done', description: isRTL ? 'تم تسجيل الاعتراض' : 'Dispute recorded' });
    } catch (e) {
      toast({ title: isRTL ? 'خطأ' : 'Error', description: describeError(e, isRTL), variant: 'destructive' });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <AppShell role="branch">
      <div className={`space-y-8 ${isRTL ? 'rtl' : 'ltr'}`}>
        {/* CP7: was a rigid flex-row justify-between — the title/description
            and the QR button competed for space at 375px. Stacks on narrow
            screens (one-handed: button lands full-width, thumb-reachable),
            row layout returns at sm+. */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-foreground mb-2">
              {isRTL ? 'تأكيدات الفرع' : 'Branch Confirmations'}
            </h1>
            <p className="text-muted-foreground">
              {isRTL ? 'تأكيد أو الاعتراض على عمليات استلام النفايات لهذا الفرع' : 'Confirm or dispute waste pickups recorded at this branch'}
            </p>
          </div>
          {branchId && (
            <Button onClick={openQr} variant="outline" className="w-full sm:w-auto h-12">
              <QrCodeIcon className="w-4 h-4 me-2" />
              {isRTL ? 'عرض رمز QR' : 'Show QR'}
            </Button>
          )}
        </div>

        {!branchId && (
          <ErrorState message={isRTL ? 'لا يوجد فرع مرتبط بهذا الحساب' : 'No branch is linked to this account'} />
        )}

        {branchId && loading && <LoadingState label={isRTL ? 'جارٍ التحميل' : 'Loading'} />}
        {branchId && !loading && loadError && (
          <ErrorState message={loadError} retry={load} retryLabel={isRTL ? 'إعادة المحاولة' : 'Retry'} />
        )}
        {branchId && !loading && !loadError && pickups.length === 0 && (
          <EmptyState
            icon={<ClockIcon />}
            title={isRTL ? 'لا توجد تأكيدات معلقة' : 'No pending confirmations'}
            hint={isRTL
              ? 'ستظهر هنا عمليات الاستلام التي تحتاج إلى تأكيد الفرع'
              : 'Pickups requiring branch confirmation will appear here'}
          />
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {pickups.map((p) => (
            <Card key={p.id} className="border-2 border-border">
              <CardContent className="pt-6 space-y-3">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-semibold text-foreground">
                      {p.weight_kg} {isRTL ? 'كجم' : 'kg'} · {p.waste_types.join(', ')}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {new Date(p.created_at).toLocaleString(isRTL ? 'ar-SA' : 'en-US')}
                    </p>
                  </div>
                </div>
                {/* CP7: was size="sm" (h-9, 36px) — below the 44px minimum
                    touch-target guidance, and this button is tapped at a
                    waste point, possibly one-handed/gloved. h-12 (48px)
                    matches the field-sized buttons already used in
                    SignaturePad/DigitalManifest. */}
                <div className="flex gap-2">
                  <Button
                    className="flex-1 h-12 bg-success text-success-foreground hover:bg-success/90"
                    disabled={busyId === p.id}
                    aria-busy={busyId === p.id}
                    onClick={() => handleConfirm(p)}
                  >
                    <CheckCircle2Icon className="w-4 h-4 me-2" />
                    {isRTL ? 'تأكيد' : 'Confirm'}
                  </Button>
                  <Button
                    variant="outline"
                    className="flex-1 h-12 text-destructive border-destructive/40"
                    disabled={busyId === p.id}
                    aria-busy={busyId === p.id}
                    onClick={() => openDispute(p)}
                  >
                    <XCircleIcon className="w-4 h-4 me-2" />
                    {isRTL ? 'اعتراض' : 'Dispute'}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      {showQr && branchId && (
        <Modal
          open
          onClose={closeQr}
          isRTL={isRTL}
          maxWidth="max-w-sm"
          title={
            <span className="flex items-center gap-2">
              <QrCodeIcon className="w-5 h-5 text-primary" />
              {isRTL ? 'رمز نقطة النفايات' : 'Waste-Point QR'}
            </span>
          }
        >
          <div className="space-y-4 text-center">
            {qrDataUrl ? (
              <img src={qrDataUrl} alt="Branch QR" className="mx-auto w-56 h-56 rounded-md border border-border bg-white p-2" />
            ) : (
              <div
                className="mx-auto w-56 h-56 rounded-md border border-border bg-muted flex items-center justify-center text-sm text-muted-foreground"
                role="status"
              >
                {isRTL ? 'جارٍ التحميل...' : 'Loading...'}
              </div>
            )}
            {qrError && <p className="text-xs text-destructive" role="alert">{qrError}</p>}
            <p className="text-xs text-muted-foreground">
              {isRTL
                ? 'اترك هذا الجهاز ظاهراً عند نقطة تسليم النفايات — الرمز يتجدد تلقائياً ويمسحه السائق'
                : 'Keep this device visible at the waste hand-over point — the code refreshes itself; the driver scans it'}
            </p>
          </div>
        </Modal>
      )}

      {disputing && (
        <Modal
          open
          onClose={() => setDisputing(null)}
          isRTL={isRTL}
          title={isRTL ? 'سبب الاعتراض' : 'Dispute Reason'}
        >
          <div className="space-y-4">
            <Textarea
              value={disputeReason}
              onChange={(e) => setDisputeReason(e.target.value)}
              placeholder={isRTL ? 'صف سبب الاعتراض على هذا الاستلام...' : 'Describe why this pickup is being disputed...'}
              aria-label={isRTL ? 'سبب الاعتراض' : 'Dispute reason'}
              rows={4}
            />
            <div className="flex gap-3">
              <Button variant="outline" className="flex-1" onClick={() => setDisputing(null)}>
                {isRTL ? 'إلغاء' : 'Cancel'}
              </Button>
              <Button
                className="flex-1 bg-destructive text-destructive-foreground hover:bg-destructive/90"
                disabled={!disputeReason.trim() || busyId === disputing.id}
                onClick={handleDisputeSubmit}
              >
                {isRTL ? 'إرسال الاعتراض' : 'Submit Dispute'}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </AppShell>
  );
}
