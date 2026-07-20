import { useCallback, useEffect, useState } from 'react';
import { useAuthStore } from '../stores/authStore';
import AppShell from '../components/AppShell';
import { listTransportTrips, createTrip, updateTripStatus } from '../lib/api/trips';
import { listActiveFacilitiesForTransport } from '../lib/api/facilities';
import { listDrivers } from '../lib/api/drivers';
import { listVehicles } from '../lib/api/vehicles';
import type { Trip, Facility, Driver, Vehicle, WasteType } from '../lib/database.types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { Loader2Icon, PlusIcon, FactoryIcon, XIcon } from 'lucide-react';
import { LoadingState, EmptyState, ErrorState } from '@/components/ui/states';

const WASTE_STREAMS: WasteType[] = ['plastic', 'industrial', 'electronic', 'medical', 'chemical', 'organic'];

const STATUS_BADGE: Record<Trip['status'], { ar: string; en: string; className: string }> = {
  planned:     { ar: 'مخطط',      en: 'Planned',     className: 'bg-muted text-muted-foreground' },
  in_progress: { ar: 'قيد التنفيذ', en: 'In Progress', className: 'bg-primary/15 text-primary' },
  dropped_off: { ar: 'تم التسليم',  en: 'Dropped Off',  className: 'bg-warning/15 text-warning' },
  reconciled:  { ar: 'مطابق',      en: 'Reconciled',   className: 'bg-success text-success-foreground' },
  cancelled:   { ar: 'ملغى',       en: 'Cancelled',    className: 'bg-destructive/15 text-destructive' },
};

export default function TransportTripsPage() {
  const { isRTL, user } = useAuthStore();
  const { toast } = useToast();
  const transportCompanyId = user?.transport_company_id ?? undefined;

  const [trips, setTrips] = useState<Trip[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showCreate, setShowCreate] = useState(false);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [driverId, setDriverId] = useState('');
  const [vehicleId, setVehicleId] = useState('');
  const [facilityId, setFacilityId] = useState('');
  const [wasteStream, setWasteStream] = useState<string>('');
  const [tripDate, setTripDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setTrips(await listTransportTrips());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function openCreate() {
    if (!transportCompanyId) return;
    setShowCreate(true);
    setDriverId('');
    setVehicleId('');
    setFacilityId('');
    setWasteStream('');
    setFormError(null);
    try {
      const [d, v, f] = await Promise.all([
        listDrivers(transportCompanyId),
        listVehicles(transportCompanyId),
        listActiveFacilitiesForTransport(transportCompanyId),
      ]);
      setDrivers(d.filter((x) => x.status === 'active'));
      setVehicles(v.filter((x) => x.status === 'active'));
      setFacilities(f);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to load form data');
    }
  }

  async function handleCreate() {
    if (!transportCompanyId || !driverId || !vehicleId || !facilityId || !wasteStream) return;
    setSaving(true);
    setFormError(null);
    try {
      await createTrip({
        transport_company_id: transportCompanyId,
        driver_id: driverId,
        vehicle_id: vehicleId,
        planned_facility_id: facilityId,
        waste_stream: wasteStream,
        trip_date: tripDate,
      });
      toast({ title: isRTL ? 'تم إنشاء الرحلة' : 'Trip created' });
      setShowCreate(false);
      await load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to create trip');
    } finally {
      setSaving(false);
    }
  }

  async function handleAdvance(trip: Trip) {
    const next = trip.status === 'planned' ? 'in_progress' : 'dropped_off';
    try {
      await updateTripStatus(trip.id, next);
      await load();
    } catch (err) {
      toast({
        title: isRTL ? 'فشل تحديث الحالة' : 'Failed to update status',
        description: err instanceof Error ? err.message : undefined,
        variant: 'destructive',
      });
    }
  }

  async function handleCancel(trip: Trip) {
    try {
      await updateTripStatus(trip.id, 'cancelled');
      await load();
    } catch (err) {
      toast({
        title: isRTL ? 'فشل إلغاء الرحلة' : 'Failed to cancel trip',
        description: err instanceof Error ? err.message : undefined,
        variant: 'destructive',
      });
    }
  }

  return (
    <AppShell role="transport">
      <div className={`space-y-6 ${isRTL ? 'rtl' : 'ltr'}`}>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-foreground mb-1">{isRTL ? 'الرحلات' : 'Trips'}</h1>
            <p className="text-muted-foreground">
              {isRTL
                ? 'خطط رحلات النقل إلى منشآت إعادة التدوير المرتبطة'
                : 'Plan hauls into your linked recycling facilities'}
            </p>
          </div>
          <Button onClick={openCreate} className="gap-2">
            <PlusIcon className="w-4 h-4" />
            {isRTL ? 'رحلة جديدة' : 'New Trip'}
          </Button>
        </div>

        {error && <ErrorState message={error} retry={load} retryLabel={isRTL ? 'إعادة المحاولة' : 'Retry'} />}

        {loading ? (
          <LoadingState label={isRTL ? 'جارٍ التحميل' : 'Loading'} />
        ) : trips.length === 0 && !error ? (
          <EmptyState
            icon={<FactoryIcon />}
            title={isRTL ? 'لا توجد رحلات بعد' : 'No trips yet'}
            hint={isRTL ? 'أنشئ رحلة لبدء تتبع التسليم إلى المنشأة' : 'Create a trip to start tracking facility drop-off'}
          />
        ) : (
          <div className="space-y-3">
            {trips.map((trip) => {
              const badge = STATUS_BADGE[trip.status];
              return (
                <Card key={trip.id} className="bg-card text-card-foreground border-border">
                  <CardContent className="pt-6 flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-sm text-foreground" dir="ltr">{trip.trip_date}</p>
                      <p className="text-xs text-muted-foreground mt-1" dir="ltr">{trip.waste_stream}</p>
                      {trip.weight_reconciliation_status === 'flagged' && (
                        <p className="text-xs text-destructive mt-1">
                          {isRTL ? '⚠ فرق وزن يتجاوز الحد المسموح' : '⚠ Weight mismatch beyond tolerance'}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge className={badge.className}>{isRTL ? badge.ar : badge.en}</Badge>
                      {(trip.status === 'planned' || trip.status === 'in_progress') && (
                        <Button size="sm" variant="outline" onClick={() => handleAdvance(trip)}>
                          {trip.status === 'planned'
                            ? (isRTL ? 'بدء الرحلة' : 'Start Trip')
                            : (isRTL ? 'تم التسليم للمنشأة' : 'Mark Dropped Off')}
                        </Button>
                      )}
                      {(trip.status === 'planned' || trip.status === 'in_progress') && (
                        <Button size="sm" variant="ghost" className="text-destructive" onClick={() => handleCancel(trip)}>
                          {isRTL ? 'إلغاء' : 'Cancel'}
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

      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/50 p-4">
          <Card className={`w-full max-w-md bg-card text-card-foreground border-border ${isRTL ? 'rtl' : 'ltr'}`}>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>{isRTL ? 'رحلة جديدة' : 'New Trip'}</CardTitle>
              <Button variant="ghost" size="icon" onClick={() => setShowCreate(false)}>
                <XIcon className="w-5 h-5" />
              </Button>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <label className="text-sm font-medium text-foreground">{isRTL ? 'السائق' : 'Driver'} *</label>
                <select
                  value={driverId}
                  onChange={(e) => setDriverId(e.target.value)}
                  className="mt-1 w-full border border-input rounded-md px-3 py-2 text-sm bg-background text-foreground"
                >
                  <option value="">{isRTL ? 'اختر سائقاً' : 'Select a driver'}</option>
                  {drivers.map((d) => <option key={d.id} value={d.id}>{d.name_ar}</option>)}
                </select>
              </div>
              <div>
                <label className="text-sm font-medium text-foreground">{isRTL ? 'المركبة' : 'Vehicle'} *</label>
                <select
                  value={vehicleId}
                  onChange={(e) => setVehicleId(e.target.value)}
                  className="mt-1 w-full border border-input rounded-md px-3 py-2 text-sm bg-background text-foreground"
                >
                  <option value="">{isRTL ? 'اختر مركبة' : 'Select a vehicle'}</option>
                  {vehicles.map((v) => <option key={v.id} value={v.id}>{v.plate_number}</option>)}
                </select>
              </div>
              <div>
                <label className="text-sm font-medium text-foreground">{isRTL ? 'منشأة الاستلام' : 'Receiving Facility'} *</label>
                <select
                  value={facilityId}
                  onChange={(e) => setFacilityId(e.target.value)}
                  className="mt-1 w-full border border-input rounded-md px-3 py-2 text-sm bg-background text-foreground"
                >
                  <option value="">{isRTL ? 'اختر منشأة' : 'Select a facility'}</option>
                  {facilities.map((f) => <option key={f.id} value={f.id}>{f.name_ar}</option>)}
                </select>
                {facilities.length === 0 && (
                  <p className="text-xs text-muted-foreground mt-1">
                    {isRTL ? 'لا توجد منشآت مرتبطة بشركتك بعد' : 'No facilities linked to your company yet'}
                  </p>
                )}
              </div>
              <div>
                <label className="text-sm font-medium text-foreground">{isRTL ? 'نوع النفايات' : 'Waste Stream'} *</label>
                <select
                  value={wasteStream}
                  onChange={(e) => setWasteStream(e.target.value)}
                  className="mt-1 w-full border border-input rounded-md px-3 py-2 text-sm bg-background text-foreground"
                >
                  <option value="">{isRTL ? 'اختر نوعاً' : 'Select a stream'}</option>
                  {WASTE_STREAMS.map((w) => <option key={w} value={w}>{w}</option>)}
                </select>
              </div>
              <div>
                <label className="text-sm font-medium text-foreground">{isRTL ? 'تاريخ الرحلة' : 'Trip Date'} *</label>
                <input
                  type="date"
                  value={tripDate}
                  onChange={(e) => setTripDate(e.target.value)}
                  className="mt-1 w-full border border-input rounded-md px-3 py-2 text-sm bg-background text-foreground"
                  dir="ltr"
                />
              </div>

              {formError && <p className="text-sm text-destructive">{formError}</p>}

              <div className="flex gap-3">
                <Button
                  onClick={handleCreate}
                  disabled={!driverId || !vehicleId || !facilityId || !wasteStream || saving}
                  className="gap-2"
                >
                  {saving && <Loader2Icon className="w-4 h-4 animate-spin" />}
                  {isRTL ? 'إنشاء' : 'Create'}
                </Button>
                <Button variant="outline" onClick={() => setShowCreate(false)}>
                  {isRTL ? 'إلغاء' : 'Cancel'}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </AppShell>
  );
}
