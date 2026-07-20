import { useCallback, useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { useAuthStore } from '../stores/authStore';
import AppShell from '../components/AppShell';
import { listDriverTrips, issueTripQrToken, updateTripStatus } from '../lib/api/trips';
import { getDisposalConfirmation } from '../lib/api/disposals';
import type { Trip, DisposalConfirmation } from '../lib/database.types';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2Icon, QrCodeIcon, FactoryIcon } from 'lucide-react';
import { LoadingState, EmptyState, ErrorState } from '@/components/ui/states';
import { Modal } from '@/components/ui/modal';

const STATUS_BADGE: Record<Trip['status'], { ar: string; en: string; className: string }> = {
  planned:     { ar: 'مخطط',       en: 'Planned',     className: 'bg-muted text-muted-foreground' },
  in_progress: { ar: 'قيد التنفيذ', en: 'In Progress', className: 'bg-primary/15 text-primary' },
  dropped_off: { ar: 'بانتظار التأكيد', en: 'Awaiting Confirmation', className: 'bg-warning/15 text-warning' },
  reconciled:  { ar: 'مكتمل',      en: 'Complete',     className: 'bg-success text-success-foreground' },
  cancelled:   { ar: 'ملغى',       en: 'Cancelled',    className: 'bg-destructive/15 text-destructive' },
};

/**
 * Driver-side trip view (CP1): shows the driver's own trips, lets them
 * advance status up to drop-off, and renders the HMAC-signed trip QR the
 * receiving facility's scale scans to open the confirmation screen. Also
 * reflects the recycler's own confirmed/rejected verdict once recorded.
 */
export default function DriverDeliveriesPage() {
  const { isRTL } = useAuthStore();

  const [trips, setTrips] = useState<Trip[]>([]);
  const [confirmations, setConfirmations] = useState<Record<string, DisposalConfirmation | null>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [qrTrip, setQrTrip] = useState<Trip | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [qrExpiresAt, setQrExpiresAt] = useState<string | null>(null);
  const [qrError, setQrError] = useState<string | null>(null);
  const [qrLoading, setQrLoading] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await listDriverTrips();
      setTrips(rows);
      const entries = await Promise.all(
        rows.map(async (t) => [t.id, await getDisposalConfirmation(t.id).catch(() => null)] as const)
      );
      setConfirmations(Object.fromEntries(entries));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  async function handleMarkDroppedOff(trip: Trip) {
    try {
      await updateTripStatus(trip.id, trip.status === 'planned' ? 'in_progress' : 'dropped_off');
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update trip');
    }
  }

  async function openQr(trip: Trip) {
    setQrTrip(trip);
    setQrDataUrl(null);
    setQrError(null);
    setQrLoading(true);
    try {
      const { token, expires_at } = await issueTripQrToken(trip.id);
      setQrDataUrl(await QRCode.toDataURL(token, { width: 280, margin: 1 }));
      setQrExpiresAt(expires_at);
    } catch (err) {
      setQrError(err instanceof Error ? err.message : 'Failed to generate QR');
    } finally {
      setQrLoading(false);
    }
  }

  return (
    <AppShell role="driver">
      <div className={`space-y-6 ${isRTL ? 'rtl' : 'ltr'}`}>
        <div>
          <h1 className="text-3xl font-bold text-foreground mb-1">
            {isRTL ? 'رحلاتي' : 'My Trips'}
          </h1>
          <p className="text-muted-foreground">
            {isRTL
              ? 'اعرض رمز QR الخاص بالرحلة عند الوصول إلى منشأة المعالجة لتأكيد التسليم'
              : 'Show the trip QR at the treatment facility to have your drop-off confirmed'}
          </p>
        </div>

        {error && (
          <ErrorState message={error} retry={reload} retryLabel={isRTL ? 'إعادة المحاولة' : 'Retry'} />
        )}

        {loading ? (
          <LoadingState label={isRTL ? 'جارٍ التحميل' : 'Loading'} />
        ) : trips.length === 0 && !error ? (
          <EmptyState
            icon={<FactoryIcon />}
            title={isRTL ? 'لا توجد رحلات مسندة إليك' : 'No trips assigned to you'}
          />
        ) : (
          <div className="space-y-3">
            {trips.map((trip) => {
              const badge = STATUS_BADGE[trip.status];
              const confirmation = confirmations[trip.id];
              return (
                <Card key={trip.id} className="bg-card text-card-foreground border-border">
                  <CardContent className="pt-6 flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-sm text-foreground" dir="ltr">{trip.trip_date} — {trip.waste_stream}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <Badge className={badge.className}>{isRTL ? badge.ar : badge.en}</Badge>
                        {confirmation?.status === 'confirmed' && (
                          <Badge className="bg-success text-success-foreground hover:bg-success">
                            {isRTL ? 'تم التأكيد من المنشأة' : 'Facility Confirmed'}
                          </Badge>
                        )}
                        {confirmation?.status === 'rejected' && (
                          <Badge variant="destructive">
                            {isRTL ? 'مرفوض من المنشأة' : 'Facility Rejected'}
                          </Badge>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {(trip.status === 'planned' || trip.status === 'in_progress') && (
                        <Button size="sm" variant="outline" onClick={() => handleMarkDroppedOff(trip)}>
                          {trip.status === 'planned'
                            ? (isRTL ? 'بدء الرحلة' : 'Start Trip')
                            : (isRTL ? 'وصلت للمنشأة' : 'Arrived at Facility')}
                        </Button>
                      )}
                      {trip.status !== 'reconciled' && trip.status !== 'cancelled' && (
                        <Button size="sm" onClick={() => openQr(trip)}>
                          <QrCodeIcon className="w-4 h-4 me-1" />
                          {isRTL ? 'عرض QR' : 'Show QR'}
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {qrTrip && (
        <Modal open onClose={() => setQrTrip(null)} isRTL={isRTL} title={isRTL ? 'رمز QR للرحلة' : 'Trip QR'}>
          <div className="flex flex-col items-center gap-4">
            {qrLoading && <Loader2Icon className="w-8 h-8 animate-spin text-primary" />}
            {qrError && <p className="text-sm text-destructive">{qrError}</p>}
            {qrDataUrl && (
              <>
                <img src={qrDataUrl} alt="Trip QR" className="rounded-lg border border-border" />
                <p className="text-xs text-muted-foreground text-center">
                  {isRTL
                    ? 'صالح لفترة قصيرة فقط — إذا انتهت صلاحيته، أعد فتح هذه الشاشة لتوليد رمز جديد'
                    : 'Short-lived — reopen this screen to generate a fresh code if it expires'}
                </p>
                {qrExpiresAt && (
                  <p className="text-xs text-muted-foreground" dir="ltr">
                    {isRTL ? 'ينتهي: ' : 'Expires: '}{new Date(qrExpiresAt).toLocaleTimeString(isRTL ? 'ar-SA' : 'en-US')}
                  </p>
                )}
              </>
            )}
            <Button variant="outline" onClick={() => setQrTrip(null)} className="w-full">
              {isRTL ? 'إغلاق' : 'Close'}
            </Button>
          </div>
        </Modal>
      )}
    </AppShell>
  );
}
