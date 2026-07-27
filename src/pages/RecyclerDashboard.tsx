import { useCallback, useEffect, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { useAuthStore } from '../stores/authStore';
import AppShell from '../components/AppShell';
import {
  listInboundTrips,
  listFacilityConfirmations,
  createDisposalConfirmation,
  type InboundTrip,
} from '../lib/api/disposals';
import { validateTripQrToken } from '../lib/api/facilities';
import { isNetworkError } from '../lib/offline/pickupQueue';
import { enqueueDisposal } from '../lib/offline/disposalQueue';
import { useNotificationStore } from '../stores/notificationStore';
import type { DisposalConfirmation, Trip } from '../lib/database.types';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Loader2Icon, MapPinIcon, ScaleIcon, QrCodeIcon,
  KeyboardIcon, XIcon, CheckCircle2Icon, XCircleIcon,
} from 'lucide-react';
import { LoadingState, EmptyState, ErrorState } from '@/components/ui/states';
import { Modal } from '@/components/ui/modal';
import CameraCapture from '../components/camera/CameraCapture';
import RestrictionBanner from '../components/documents/RestrictionBanner';

const QR_ELEMENT_ID = 'recycler-qr-reader';

export default function RecyclerDashboard() {
  const { isRTL, user } = useAuthStore();
  const isManager = user?.role === 'recycler_manager';

  return isManager
    ? <RecyclerHistory isRTL={isRTL} facilityId={user?.facility_id ?? null} />
    : <ScaleOperatorConsole isRTL={isRTL} />;
}

// ─── recycler_manager: facility confirmation history ────────────────────────
function RecyclerHistory({ isRTL, facilityId }: { isRTL: boolean; facilityId: string | null }) {
  const [rows, setRows] = useState<DisposalConfirmation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRows(await listFacilityConfirmations());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <AppShell role="recycler">
      <div className={`space-y-6 ${isRTL ? 'rtl' : 'ltr'}`}>
        <div>
          <h1 className="text-3xl font-bold text-foreground mb-1">
            {isRTL ? 'سجل التأكيدات' : 'Confirmation History'}
          </h1>
          <p className="text-muted-foreground">
            {isRTL ? 'كل تأكيدات وأوزان التسليم في منشأتك' : 'All drop-off confirmations and weights at your facility'}
          </p>
        </div>

        {facilityId && <RestrictionBanner ownerType="facility" ownerId={facilityId} isRTL={isRTL} />}

        {error && <ErrorState message={error} retry={load} retryLabel={isRTL ? 'إعادة المحاولة' : 'Retry'} />}

        {loading ? (
          <LoadingState label={isRTL ? 'جارٍ التحميل' : 'Loading'} />
        ) : rows.length === 0 && !error ? (
          <EmptyState
            icon={<ScaleIcon />}
            title={isRTL ? 'لا توجد تأكيدات بعد' : 'No confirmations yet'}
          />
        ) : (
          <Card className="bg-card text-card-foreground border-border">
            <CardContent className="pt-6 overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border">
                    <th className="p-3 text-sm font-medium text-muted-foreground text-start">{isRTL ? 'الرحلة' : 'Trip'}</th>
                    <th className="p-3 text-sm font-medium text-muted-foreground text-start">{isRTL ? 'الحالة' : 'Status'}</th>
                    <th className="p-3 text-sm font-medium text-muted-foreground text-start">{isRTL ? 'الوزن الصافي' : 'Net Weight'}</th>
                    <th className="p-3 text-sm font-medium text-muted-foreground text-start">{isRTL ? 'التاريخ' : 'Date'}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className="border-b border-border">
                      <td className="p-3 text-sm text-foreground" dir="ltr">{r.trip_id.slice(0, 8)}</td>
                      <td className="p-3 text-sm">
                        {r.status === 'confirmed' ? (
                          <Badge className="bg-success text-success-foreground hover:bg-success">
                            {isRTL ? 'مؤكد' : 'Confirmed'}
                          </Badge>
                        ) : (
                          <Badge variant="destructive">{isRTL ? 'مرفوض' : 'Rejected'}</Badge>
                        )}
                      </td>
                      <td className="p-3 text-sm text-foreground" dir="ltr">
                        {r.net_weight_kg != null ? `${r.net_weight_kg} kg` : '—'}
                      </td>
                      <td className="p-3 text-sm text-foreground" dir="ltr">
                        {r.confirmed_at ? new Date(r.confirmed_at).toLocaleString(isRTL ? 'ar-SA' : 'en-US') : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        )}
      </div>
    </AppShell>
  );
}

// ─── scale_operator: inbound trips + scan/confirm flow ──────────────────────
function ScaleOperatorConsole({ isRTL }: { isRTL: boolean }) {
  const [inbound, setInbound] = useState<InboundTrip[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [confirming, setConfirming] = useState<Trip | null>(null);
  const [scanning, setScanning] = useState(false);
  // CP7: was a single raw err.message string (sometimes a technical,
  // non-bilingual DOMException message) — now the same camera-vs-token
  // distinction as driver/QRScanner.tsx: 'camera' means the camera itself
  // never started (permission/hardware), 'token' means the camera worked
  // but the scanned/typed code failed server-side validation.
  const [scanError, setScanError] = useState<{ kind: 'camera' | 'token'; detail?: string } | null>(null);
  const [manualToken, setManualToken] = useState('');
  const scannerRef = useRef<Html5Qrcode | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setInbound(await listInboundTrips());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  function stopScanner() {
    try {
      scannerRef.current?.stop().catch(() => null);
    } catch {
      /* scanner was never running */
    }
    setScanning(false);
  }

  async function handleScanResult(token: string) {
    stopScanner();
    try {
      const result = await validateTripQrToken(token);
      setConfirming(result.trip);
    } catch (err) {
      setScanError({ kind: 'token', detail: err instanceof Error ? err.message : String(err) });
    }
  }

  function openScanner() {
    setScanError(null);
    setManualToken('');
    setScanning(true);
    setTimeout(() => {
      const scanner = new Html5Qrcode(QR_ELEMENT_ID, { verbose: false });
      scannerRef.current = scanner;
      scanner
        .start(
          { facingMode: 'environment' },
          { fps: 10, qrbox: { width: 250, height: 250 } },
          (decodedText) => { void handleScanResult(decodedText); },
          () => { /* frame without QR — ignore */ }
        )
        .catch((err: unknown) => {
          setScanError({ kind: 'camera', detail: err instanceof Error ? err.message : String(err) });
        });
    }, 100);
  }

  function scanErrorMessage(): string {
    if (!scanError) return '';
    if (scanError.kind === 'camera') {
      return isRTL
        ? 'تعذّر تشغيل الكاميرا. أدخل الرمز يدوياً أدناه.'
        : 'Could not start the camera. Enter the token manually below.';
    }
    return isRTL
      ? `تعذّر التحقق من الرمز: ${scanError.detail ?? ''}`
      : `Could not validate the token: ${scanError.detail ?? ''}`;
  }

  return (
    <AppShell role="recycler">
      <div className={`space-y-6 ${isRTL ? 'rtl' : 'ltr'}`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-3xl font-bold text-foreground mb-1">
              {isRTL ? 'الرحلات الواردة' : 'Inbound Trips'}
            </h1>
            <p className="text-muted-foreground">
              {isRTL
                ? 'امسح رمز QR الخاص بالرحلة أو اختر من القائمة أدناه لتسجيل الوزن الصافي'
                : 'Scan a trip QR or pick from the list below to record the net weight'}
            </p>
          </div>
          <Button onClick={openScanner} className="gap-2">
            <QrCodeIcon className="w-4 h-4" />
            {isRTL ? 'مسح رمز QR' : 'Scan QR'}
          </Button>
        </div>

        {error && <ErrorState message={error} retry={load} retryLabel={isRTL ? 'إعادة المحاولة' : 'Retry'} />}

        {loading ? (
          <LoadingState label={isRTL ? 'جارٍ التحميل' : 'Loading'} />
        ) : inbound.length === 0 && !error ? (
          <EmptyState
            icon={<ScaleIcon />}
            title={isRTL ? 'لا توجد رحلات بانتظار التأكيد' : 'No trips awaiting confirmation'}
          />
        ) : (
          <div className="space-y-3">
            {inbound.map(({ trip }) => (
              <Card key={trip.id} className="bg-card text-card-foreground border-border">
                <CardContent className="pt-6 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-sm text-foreground" dir="ltr">{trip.trip_date} — {trip.waste_stream}</p>
                    <p className="text-xs text-muted-foreground mt-1" dir="ltr">{trip.id.slice(0, 8)}</p>
                  </div>
                  <Button size="sm" onClick={() => setConfirming(trip)}>
                    <ScaleIcon className="w-4 h-4 me-1" />
                    {isRTL ? 'تسجيل الوزن' : 'Record Weight'}
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {scanning && (
        <Modal open onClose={stopScanner} isRTL={isRTL} title={isRTL ? 'مسح رمز QR' : 'Scan QR'}>
          <div className="space-y-4">
            <div
              id={QR_ELEMENT_ID}
              className="w-full rounded-lg overflow-hidden bg-muted"
              style={{ minHeight: 280 }}
              aria-label={isRTL ? 'عرض كاميرا مسح رمز QR' : 'QR scanner camera view'}
              role="img"
            />
            {scanError && <p className="text-sm text-destructive" role="alert">{scanErrorMessage()}</p>}
            <div className="space-y-2">
              <Label className="text-foreground">{isRTL ? 'أو أدخل الرمز يدوياً' : 'Or enter the token manually'}</Label>
              <div className="flex gap-2">
                <Input
                  value={manualToken}
                  onChange={(e) => setManualToken(e.target.value)}
                  dir="ltr"
                  className="bg-background text-foreground border-input"
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void handleScanResult(manualToken.trim())}
                  disabled={!manualToken.trim()}
                >
                  <KeyboardIcon className="w-4 h-4" />
                </Button>
              </div>
            </div>
            <Button variant="outline" onClick={stopScanner} className="w-full">
              <XIcon className="w-4 h-4 me-2" />
              {isRTL ? 'إغلاق' : 'Close'}
            </Button>
          </div>
        </Modal>
      )}

      {confirming && (
        <ConfirmTripModal
          trip={confirming}
          isRTL={isRTL}
          onClose={() => setConfirming(null)}
          onDone={() => { setConfirming(null); void load(); }}
        />
      )}
    </AppShell>
  );
}

function ConfirmTripModal({
  trip, isRTL, onClose, onDone,
}: {
  trip: Trip;
  isRTL: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const [outcome, setOutcome] = useState<'confirmed' | 'rejected'>('confirmed');
  const [netWeight, setNetWeight] = useState('');
  const [rejectReason, setRejectReason] = useState('');
  const [photoFile, setPhotoFile] = useState<File | undefined>(undefined);
  const [gps, setGps] = useState<{ lat: number; lng: number } | null>(null);
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  function captureGps() {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => setGps({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => setFormError(isRTL ? 'تعذر تحديد الموقع' : 'Could not get location')
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (outcome === 'confirmed' && !netWeight.trim()) {
      setFormError(isRTL ? 'الوزن الصافي مطلوب' : 'Net weight is required');
      return;
    }
    if (outcome === 'rejected' && !rejectReason.trim()) {
      setFormError(isRTL ? 'سبب الرفض مطلوب' : 'Reject reason is required');
      return;
    }
    setSubmitting(true);
    setFormError(null);
    try {
      await createDisposalConfirmation(
        { id: trip.id, planned_facility_id: trip.planned_facility_id },
        {
          status: outcome,
          reject_reason: outcome === 'rejected' ? rejectReason.trim() : undefined,
          net_weight_kg: outcome === 'confirmed' ? Number(netWeight) : undefined,
          gps_lat: gps?.lat,
          gps_lng: gps?.lng,
          notes: notes.trim() || undefined,
        },
        photoFile
      );
      onDone();
    } catch (err) {
      if (isNetworkError(err)) {
        try {
          await enqueueDisposal({
            tripId: trip.id,
            facilityId: trip.planned_facility_id,
            status: outcome,
            rejectReason: outcome === 'rejected' ? rejectReason.trim() : undefined,
            netWeightKg: outcome === 'confirmed' ? Number(netWeight) : undefined,
            gpsLat: gps?.lat,
            gpsLng: gps?.lng,
            notes: notes.trim() || undefined,
            photoBlob: photoFile,
            photoName: photoFile?.name,
            photoType: photoFile?.type,
            queuedAt: Date.now(),
            attempts: 0,
          });
          useNotificationStore.getState().addNotification({
            type: 'info',
            priority: 'medium',
            title: 'تم الحفظ محلياً',
            titleEn: 'Saved Offline',
            message: 'سيُرسل التأكيد تلقائياً عند عودة الاتصال',
            messageEn: 'The confirmation will sync automatically when back online',
            autoHide: true,
            duration: 5000,
          });
          onDone();
          return;
        } catch {
          /* IndexedDB unavailable — fall through to the error path */
        }
      }
      setFormError(err instanceof Error ? err.message : 'Failed to submit');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open onClose={onClose} isRTL={isRTL} title={isRTL ? 'تأكيد التسليم' : 'Confirm Drop-off'}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="flex gap-2">
          <Button
            type="button"
            variant={outcome === 'confirmed' ? 'default' : 'outline'}
            className="flex-1 gap-2"
            onClick={() => setOutcome('confirmed')}
          >
            <CheckCircle2Icon className="w-4 h-4" />
            {isRTL ? 'تأكيد' : 'Confirm'}
          </Button>
          <Button
            type="button"
            variant={outcome === 'rejected' ? 'destructive' : 'outline'}
            className="flex-1 gap-2"
            onClick={() => setOutcome('rejected')}
          >
            <XCircleIcon className="w-4 h-4" />
            {isRTL ? 'رفض' : 'Reject'}
          </Button>
        </div>

        {outcome === 'confirmed' ? (
          <>
            <div className="space-y-2">
              <Label className="text-foreground">{isRTL ? 'الوزن الصافي (كجم)' : 'Net Weight (kg)'} *</Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={netWeight}
                onChange={(e) => setNetWeight(e.target.value)}
                dir="ltr"
                required
                className="bg-background text-foreground border-input"
              />
            </div>

            <CameraCapture
              isRTL={isRTL}
              label={isRTL ? 'صورة الميزان' : 'Weighbridge Photo'}
              capturedLabel={isRTL ? 'تم التقاط صورة الميزان' : 'Weighbridge photo captured'}
              capturedFile={photoFile}
              onCapture={setPhotoFile}
              fileNameBase="weighbridge-photo"
            />
          </>
        ) : (
          <div className="space-y-2">
            <Label className="text-foreground">{isRTL ? 'سبب الرفض' : 'Reject Reason'} *</Label>
            <Input
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              required
              className="bg-background text-foreground border-input"
            />
          </div>
        )}

        <div className="flex items-center gap-3">
          <Button type="button" variant="outline" size="sm" onClick={captureGps}>
            <MapPinIcon className="w-4 h-4 me-1" />
            {isRTL ? 'التقاط الموقع' : 'Capture GPS'}
          </Button>
          {gps && (
            <span className="text-xs text-muted-foreground" dir="ltr">
              {gps.lat.toFixed(5)}, {gps.lng.toFixed(5)}
            </span>
          )}
        </div>

        <div className="space-y-2">
          <Label className="text-foreground">{isRTL ? 'ملاحظات (اختياري)' : 'Notes (optional)'}</Label>
          <Input value={notes} onChange={(e) => setNotes(e.target.value)} className="bg-background text-foreground border-input" />
        </div>

        {formError && <p className="text-sm text-destructive" role="alert">{formError}</p>}

        <div className="flex gap-3">
          <Button type="submit" disabled={submitting} className="gap-2">
            {submitting && <Loader2Icon className="w-4 h-4 animate-spin" />}
            {isRTL ? 'إرسال' : 'Submit'}
          </Button>
          <Button type="button" variant="outline" onClick={onClose}>
            {isRTL ? 'إلغاء' : 'Cancel'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
