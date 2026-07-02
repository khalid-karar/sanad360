import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuthStore } from '../stores/authStore';
import AppShell from '../components/AppShell';
import {
  listPendingDeliveries,
  createDisposalConfirmation,
} from '../lib/api/disposals';
import type { PendingDelivery } from '../lib/api/disposals';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Loader2Icon, XIcon, CameraIcon, CheckIcon, MapPinIcon, FactoryIcon,
} from 'lucide-react';

/**
 * Disposal leg (chain of custody): after a pickup is collected, the driver
 * confirms delivery at the receiving facility — facility identity, weighbridge
 * ticket photo (hashed), GPS. One confirmation per ledger event; append-only.
 */
export default function DriverDeliveriesPage() {
  const { isRTL } = useAuthStore();

  const [deliveries, setDeliveries] = useState<PendingDelivery[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Confirmation form state
  const [confirming, setConfirming] = useState<PendingDelivery | null>(null);
  const [facilityName, setFacilityName] = useState('');
  const [facilityLicense, setFacilityLicense] = useState('');
  const [ticketFile, setTicketFile] = useState<File | undefined>(undefined);
  const [gps, setGps] = useState<{ lat: number; lng: number } | null>(null);
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const ticketInputRef = useRef<HTMLInputElement>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setDeliveries(await listPendingDeliveries());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  function openConfirm(d: PendingDelivery) {
    setConfirming(d);
    setFacilityName('');
    setFacilityLicense('');
    setTicketFile(undefined);
    setGps(null);
    setNotes('');
    setFormError(null);
  }

  function captureGps() {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => setGps({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => setFormError(isRTL ? 'تعذر تحديد الموقع' : 'Could not get location')
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!confirming) return;
    if (!facilityName.trim()) {
      setFormError(isRTL ? 'اسم المنشأة المستقبلة مطلوب' : 'Facility name is required');
      return;
    }
    setSubmitting(true);
    setFormError(null);
    try {
      await createDisposalConfirmation(
        confirming.event,
        {
          facility_name_ar: facilityName.trim(),
          facility_license_number: facilityLicense.trim() || undefined,
          gps_lat: gps?.lat,
          gps_lng: gps?.lng,
          notes: notes.trim() || undefined,
        },
        ticketFile
      );
      setConfirming(null);
      await reload();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to confirm');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AppShell role="driver">
      <div className={`space-y-6 ${isRTL ? 'rtl' : 'ltr'}`}>
        <div>
          <h1 className="text-3xl font-bold text-foreground mb-1">
            {isRTL ? 'تأكيد التسليم' : 'Deliveries'}
          </h1>
          <p className="text-muted-foreground">
            {isRTL
              ? 'أكّد تسليم النفايات في منشأة المعالجة لإغلاق سلسلة العهدة'
              : 'Confirm delivery at the treatment facility to close the chain of custody'}
          </p>
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        {loading ? (
          <div className="flex justify-center py-8">
            <Loader2Icon className="w-6 h-6 animate-spin text-primary" />
          </div>
        ) : deliveries.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            {isRTL ? 'لا توجد التقاطات بانتظار تأكيد التسليم' : 'No pickups awaiting delivery confirmation'}
          </p>
        ) : (
          <div className="space-y-3">
            {deliveries.map((d) => (
              <Card key={d.event.id} className="bg-card text-card-foreground border-border">
                <CardContent className="pt-6 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-sm text-foreground" dir="ltr">
                      {new Date(d.event.created_at).toLocaleString(isRTL ? 'ar-SA' : 'en-GB')}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1" dir="ltr">
                      {d.event.weight_kg} kg — {d.event.waste_types.join(', ')}
                    </p>
                  </div>
                  <Button size="sm" onClick={() => openConfirm(d)}>
                    <FactoryIcon className="w-4 h-4 mr-1" />
                    {isRTL ? 'تأكيد التسليم' : 'Confirm Delivery'}
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {confirming && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/50 p-4">
          <Card className={`w-full max-w-md max-h-[90vh] overflow-y-auto bg-card text-card-foreground border-border ${isRTL ? 'rtl' : 'ltr'}`}>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>{isRTL ? 'تأكيد التسليم' : 'Confirm Delivery'}</CardTitle>
              <Button variant="ghost" size="icon" onClick={() => setConfirming(null)}>
                <XIcon className="w-5 h-5" />
              </Button>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label className="text-foreground">
                    {isRTL ? 'اسم منشأة المعالجة' : 'Receiving Facility Name'} *
                  </Label>
                  <Input
                    value={facilityName}
                    onChange={(e) => setFacilityName(e.target.value)}
                    required
                    className="bg-background text-foreground border-input"
                  />
                </div>

                <div className="space-y-2">
                  <Label className="text-foreground">
                    {isRTL ? 'رقم ترخيص المنشأة (اختياري)' : 'Facility License (optional)'}
                  </Label>
                  <Input
                    value={facilityLicense}
                    onChange={(e) => setFacilityLicense(e.target.value)}
                    dir="ltr"
                    className="bg-background text-foreground border-input"
                  />
                </div>

                {/* Weighbridge ticket photo */}
                <input
                  ref={ticketInputRef}
                  type="file"
                  accept="image/*,application/pdf"
                  capture="environment"
                  className="hidden"
                  onChange={(e) => setTicketFile(e.target.files?.[0])}
                />
                <Button
                  type="button"
                  variant="outline"
                  className={`w-full ${ticketFile ? 'border-success text-success' : 'bg-background text-foreground border-border'}`}
                  onClick={() => ticketInputRef.current?.click()}
                >
                  {ticketFile
                    ? <><CheckIcon className="w-4 h-4 mr-2" />{isRTL ? 'تم التقاط إيصال الميزان' : 'Ticket captured'}</>
                    : <><CameraIcon className="w-4 h-4 mr-2" />{isRTL ? 'صورة إيصال الميزان' : 'Weighbridge Ticket Photo'}</>}
                </Button>

                <div className="flex items-center gap-3">
                  <Button type="button" variant="outline" size="sm" onClick={captureGps}>
                    <MapPinIcon className="w-4 h-4 mr-1" />
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
                  <Input
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    className="bg-background text-foreground border-input"
                  />
                </div>

                {formError && <p className="text-sm text-destructive">{formError}</p>}

                <div className="flex gap-3">
                  <Button type="submit" disabled={submitting} className="gap-2">
                    {submitting && <Loader2Icon className="w-4 h-4 animate-spin" />}
                    {isRTL ? 'تأكيد' : 'Confirm'}
                  </Button>
                  <Button type="button" variant="outline" onClick={() => setConfirming(null)}>
                    {isRTL ? 'إلغاء' : 'Cancel'}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      )}
    </AppShell>
  );
}
