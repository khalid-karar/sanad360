import { useCallback, useEffect, useState } from 'react';
import { useAuthStore } from '../../stores/authStore';
import AppShell from '../AppShell';
import {
  listAssignments,
  updateAssignmentStatus,
  completeAssignment,
} from '../../lib/api/assignments';
import { createPickupEvent } from '../../lib/api/pickups';
import type { PickupAssignment, WasteType } from '../../lib/database.types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2Icon, XIcon } from 'lucide-react';
import { StatusBadge } from './statusBadge';

const WASTE_TYPES: { value: WasteType; ar: string; en: string }[] = [
  { value: 'industrial', ar: 'صناعية', en: 'Industrial' },
  { value: 'plastic', ar: 'بلاستيك', en: 'Plastic' },
  { value: 'chemical', ar: 'كيميائية', en: 'Chemical' },
  { value: 'organic', ar: 'عضوية', en: 'Organic' },
  { value: 'electronic', ar: 'إلكترونية', en: 'Electronic' },
  { value: 'medical', ar: 'طبية', en: 'Medical' },
];

export default function MySchedulePage() {
  const { isRTL, user } = useAuthStore();
  const driverRecordId = user?.driver_record_id ?? undefined;

  const [assignments, setAssignments] = useState<PickupAssignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Completion mini-form state
  const [completing, setCompleting] = useState<PickupAssignment | null>(null);
  const [weight, setWeight] = useState('');
  const [selectedWaste, setSelectedWaste] = useState<WasteType[]>([]);
  const [photoPath, setPhotoPath] = useState('');
  const [signaturePath, setSignaturePath] = useState('');
  const [useGps, setUseGps] = useState(false);
  const [gps, setGps] = useState<{ lat: number; lng: number } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const reload = useCallback(async () => {
    if (!driverRecordId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      // RLS already restricts drivers to their transport company's assignments;
      // we additionally filter by this driver's own record for a personal view.
      const list = await listAssignments({ driverId: driverRecordId });
      setAssignments(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [driverRecordId]);

  useEffect(() => {
    reload();
  }, [reload]);

  async function transition(id: string, status: 'accepted' | 'in_progress' | 'cancelled') {
    try {
      await updateAssignmentStatus(id, status);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update');
    }
  }

  function openComplete(a: PickupAssignment) {
    setCompleting(a);
    setWeight('');
    setSelectedWaste([]);
    setPhotoPath('');
    setSignaturePath('');
    setUseGps(false);
    setGps(null);
    setError(null);
  }

  function captureGps() {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGps({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setUseGps(true);
      },
      () => setError(isRTL ? 'تعذر تحديد الموقع' : 'Could not get location')
    );
  }

  function toggleWaste(w: WasteType) {
    setSelectedWaste((prev) => (prev.includes(w) ? prev.filter((x) => x !== w) : [...prev, w]));
  }

  async function handleComplete(e: React.FormEvent) {
    e.preventDefault();
    if (!completing || !user) return;
    if (selectedWaste.length === 0) {
      setError(isRTL ? 'اختر نوع نفايات واحد على الأقل' : 'Select at least one waste type');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      // 1. Append to the immutable ledger — the trigger computes risk_score +
      //    geofence_verified server-side.
      const event = await createPickupEvent({
        company_id: completing.company_id,
        branch_id: completing.branch_id,
        transport_company_id: user.transport_company_id ?? '',
        driver_id: completing.driver_id,
        vehicle_id: completing.vehicle_id,
        waste_types: selectedWaste,
        weight_kg: Number(weight),
        gps_lat: useGps && gps ? gps.lat : undefined,
        gps_lng: useGps && gps ? gps.lng : undefined,
        photo_path: photoPath || undefined,
        signature_path: signaturePath || undefined,
      });
      // 2. Link the event and flip the assignment to completed.
      await completeAssignment(completing.id, event.id);
      setCompleting(null);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to complete');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AppShell role="driver">
      <div className={`space-y-6 ${isRTL ? 'rtl' : 'ltr'}`}>
        <div>
          <h1 className="text-3xl font-bold text-foreground mb-1">{isRTL ? 'جدولي' : 'My Schedule'}</h1>
          <p className="text-muted-foreground">
            {isRTL ? 'مهام الالتقاط المسندة إليك' : 'Pickup assignments assigned to you'}
          </p>
        </div>

        {error && !completing && <p className="text-sm text-destructive">{error}</p>}

        {!driverRecordId ? (
          <p className="text-muted-foreground text-sm">
            {isRTL ? 'لا يوجد سجل سائق مرتبط بحسابك.' : 'No driver record linked to your account.'}
          </p>
        ) : loading ? (
          <div className="flex justify-center py-8">
            <Loader2Icon className="w-6 h-6 animate-spin text-primary" />
          </div>
        ) : assignments.length === 0 ? (
          <p className="text-muted-foreground text-sm">{isRTL ? 'لا توجد مهام' : 'No assignments'}</p>
        ) : (
          <div className="space-y-3">
            {assignments.map((a) => (
              <Card key={a.id} className="bg-card text-card-foreground border-border">
                <CardContent className="pt-6 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-sm text-foreground" dir="ltr">
                      {new Date(a.scheduled_at).toLocaleString(isRTL ? 'ar-SA' : 'en-GB')}
                    </p>
                    {a.notes && <p className="text-xs text-muted-foreground mt-1">{a.notes}</p>}
                    <div className="mt-2">
                      <StatusBadge status={a.status} isRTL={isRTL} />
                    </div>
                  </div>
                  <div className="flex gap-2 flex-wrap">
                    {a.status === 'pending' && (
                      <Button size="sm" onClick={() => transition(a.id, 'accepted')}>
                        {isRTL ? 'قبول' : 'Accept'}
                      </Button>
                    )}
                    {a.status === 'accepted' && (
                      <Button size="sm" onClick={() => transition(a.id, 'in_progress')}>
                        {isRTL ? 'بدء' : 'Start'}
                      </Button>
                    )}
                    {a.status === 'in_progress' && (
                      <Button size="sm" onClick={() => openComplete(a)}>
                        {isRTL ? 'إكمال' : 'Complete'}
                      </Button>
                    )}
                    {(a.status === 'pending' || a.status === 'accepted') && (
                      <Button size="sm" variant="outline" onClick={() => transition(a.id, 'cancelled')}>
                        {isRTL ? 'إلغاء' : 'Cancel'}
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Completion mini-form */}
      {completing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/50 p-4">
          <Card className={`w-full max-w-md max-h-[90vh] overflow-y-auto bg-card text-card-foreground border-border ${isRTL ? 'rtl' : 'ltr'}`}>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>{isRTL ? 'إكمال الالتقاط' : 'Complete Pickup'}</CardTitle>
              <Button variant="ghost" size="icon" onClick={() => setCompleting(null)}>
                <XIcon className="w-5 h-5" />
              </Button>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleComplete} className="space-y-4">
                <div>
                  <label className="text-sm font-medium text-foreground">
                    {isRTL ? 'الوزن (كجم)' : 'Weight (kg)'} *
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.1"
                    value={weight}
                    onChange={(e) => setWeight(e.target.value)}
                    required
                    dir="ltr"
                    className="mt-1 w-full border border-input rounded-md px-3 py-2 text-sm bg-background text-foreground"
                  />
                </div>

                <div>
                  <label className="text-sm font-medium text-foreground">
                    {isRTL ? 'أنواع النفايات' : 'Waste Types'} *
                  </label>
                  <div className="flex flex-wrap gap-2 mt-2">
                    {WASTE_TYPES.map((w) => (
                      <button
                        key={w.value}
                        type="button"
                        onClick={() => toggleWaste(w.value)}
                        className={`px-3 py-1 rounded-full text-xs border ${
                          selectedWaste.includes(w.value)
                            ? 'bg-primary text-primary-foreground border-primary'
                            : 'bg-background text-foreground border-border'
                        }`}
                      >
                        {isRTL ? w.ar : w.en}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="text-sm font-medium text-foreground">
                    {isRTL ? 'مسار الصورة (اختياري)' : 'Photo path (optional)'}
                  </label>
                  <input
                    type="text"
                    value={photoPath}
                    onChange={(e) => setPhotoPath(e.target.value)}
                    dir="ltr"
                    className="mt-1 w-full border border-input rounded-md px-3 py-2 text-sm bg-background text-foreground"
                  />
                </div>

                <div>
                  <label className="text-sm font-medium text-foreground">
                    {isRTL ? 'مسار التوقيع (اختياري)' : 'Signature path (optional)'}
                  </label>
                  <input
                    type="text"
                    value={signaturePath}
                    onChange={(e) => setSignaturePath(e.target.value)}
                    dir="ltr"
                    className="mt-1 w-full border border-input rounded-md px-3 py-2 text-sm bg-background text-foreground"
                  />
                </div>

                <div className="flex items-center gap-3">
                  <Button type="button" variant="outline" size="sm" onClick={captureGps}>
                    {isRTL ? 'التقاط الموقع' : 'Capture GPS'}
                  </Button>
                  {useGps && gps && (
                    <span className="text-xs text-muted-foreground" dir="ltr">
                      {gps.lat.toFixed(5)}, {gps.lng.toFixed(5)}
                    </span>
                  )}
                </div>

                {error && <p className="text-sm text-destructive">{error}</p>}

                <div className="flex gap-3">
                  <Button type="submit" disabled={submitting} className="gap-2">
                    {submitting && <Loader2Icon className="w-4 h-4 animate-spin" />}
                    {isRTL ? 'إكمال' : 'Complete'}
                  </Button>
                  <Button type="button" variant="outline" onClick={() => setCompleting(null)}>
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
