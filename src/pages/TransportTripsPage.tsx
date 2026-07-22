import { useCallback, useEffect, useState } from 'react';
import { useAuthStore } from '../stores/authStore';
import AppShell from '../components/AppShell';
import { listTransportTrips, createTrip, updateTripStatus } from '../lib/api/trips';
import { listActiveFacilitiesForTransport } from '../lib/api/facilities';
import { listDrivers } from '../lib/api/drivers';
import { listVehicles } from '../lib/api/vehicles';
import {
  listAssignmentsForTrip, listUnlinkedAssignmentsForTransport,
  linkAssignmentToTrip, unlinkAssignmentFromTrip,
} from '../lib/api/assignments';
import type { Trip, Facility, Driver, Vehicle, WasteType, PickupAssignment } from '../lib/database.types';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { Loader2Icon, PlusIcon, FactoryIcon, LinkIcon, Link2OffIcon, ListChecksIcon } from 'lucide-react';
import { LoadingState, EmptyState, ErrorState } from '@/components/ui/states';
import { Modal } from '@/components/ui/modal';
import { formatDateTime } from '../lib/format';

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

  // Group existing pickup requests into a trip
  const [managingTrip, setManagingTrip] = useState<Trip | null>(null);
  const [linkedAssignments, setLinkedAssignments] = useState<PickupAssignment[]>([]);
  const [unlinkedAssignments, setUnlinkedAssignments] = useState<PickupAssignment[]>([]);
  const [manageLoading, setManageLoading] = useState(false);
  const [manageBusyId, setManageBusyId] = useState<string | null>(null);

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

  async function openManage(trip: Trip) {
    setManagingTrip(trip);
    setManageLoading(true);
    try {
      const [linked, unlinked] = await Promise.all([
        listAssignmentsForTrip(trip.id),
        listUnlinkedAssignmentsForTransport(),
      ]);
      setLinkedAssignments(linked);
      setUnlinkedAssignments(unlinked);
    } catch (err) {
      toast({
        title: isRTL ? 'فشل التحميل' : 'Failed to load',
        description: err instanceof Error ? err.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setManageLoading(false);
    }
  }

  async function reloadManage(trip: Trip) {
    const [linked, unlinked] = await Promise.all([
      listAssignmentsForTrip(trip.id),
      listUnlinkedAssignmentsForTransport(),
    ]);
    setLinkedAssignments(linked);
    setUnlinkedAssignments(unlinked);
  }

  async function handleLink(assignmentId: string) {
    if (!managingTrip) return;
    setManageBusyId(assignmentId);
    try {
      await linkAssignmentToTrip(assignmentId, managingTrip.id);
      await reloadManage(managingTrip);
    } catch (err) {
      toast({
        title: isRTL ? 'فشل الربط' : 'Failed to link',
        description: err instanceof Error ? err.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setManageBusyId(null);
    }
  }

  async function handleUnlink(assignmentId: string) {
    if (!managingTrip) return;
    setManageBusyId(assignmentId);
    try {
      await unlinkAssignmentFromTrip(assignmentId);
      await reloadManage(managingTrip);
    } catch (err) {
      toast({
        title: isRTL ? 'فشل الإلغاء' : 'Failed to unlink',
        description: err instanceof Error ? err.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setManageBusyId(null);
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
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
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
                        <Button size="sm" variant="outline" className="gap-1" onClick={() => openManage(trip)}>
                          <ListChecksIcon className="w-4 h-4" />
                          {isRTL ? 'طلبات الالتقاط' : 'Pickup Requests'}
                        </Button>
                      )}
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
        <Modal open onClose={() => setShowCreate(false)} isRTL={isRTL} maxWidth="max-w-md" title={isRTL ? 'رحلة جديدة' : 'New Trip'}>
          <div className="space-y-4">
              <div>
                <label className="text-sm font-medium text-foreground" htmlFor="trip-driver">{isRTL ? 'السائق' : 'Driver'} *</label>
                <select
                  id="trip-driver"
                  value={driverId}
                  onChange={(e) => setDriverId(e.target.value)}
                  className="mt-1 w-full border border-input rounded-md px-3 py-2 text-sm bg-background text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                >
                  <option value="">{isRTL ? 'اختر سائقاً' : 'Select a driver'}</option>
                  {drivers.map((d) => <option key={d.id} value={d.id}>{d.name_ar}</option>)}
                </select>
              </div>
              <div>
                <label className="text-sm font-medium text-foreground" htmlFor="trip-vehicle">{isRTL ? 'المركبة' : 'Vehicle'} *</label>
                <select
                  id="trip-vehicle"
                  value={vehicleId}
                  onChange={(e) => setVehicleId(e.target.value)}
                  className="mt-1 w-full border border-input rounded-md px-3 py-2 text-sm bg-background text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                >
                  <option value="">{isRTL ? 'اختر مركبة' : 'Select a vehicle'}</option>
                  {vehicles.map((v) => <option key={v.id} value={v.id}>{v.plate_number}</option>)}
                </select>
              </div>
              <div>
                <label className="text-sm font-medium text-foreground" htmlFor="trip-facility">{isRTL ? 'منشأة الاستلام' : 'Receiving Facility'} *</label>
                <select
                  id="trip-facility"
                  value={facilityId}
                  onChange={(e) => setFacilityId(e.target.value)}
                  className="mt-1 w-full border border-input rounded-md px-3 py-2 text-sm bg-background text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
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
                <label className="text-sm font-medium text-foreground" htmlFor="trip-waste-stream">{isRTL ? 'نوع النفايات' : 'Waste Stream'} *</label>
                <select
                  id="trip-waste-stream"
                  value={wasteStream}
                  onChange={(e) => setWasteStream(e.target.value)}
                  className="mt-1 w-full border border-input rounded-md px-3 py-2 text-sm bg-background text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                >
                  <option value="">{isRTL ? 'اختر نوعاً' : 'Select a stream'}</option>
                  {WASTE_STREAMS.map((w) => <option key={w} value={w}>{w}</option>)}
                </select>
              </div>
              <div>
                <label className="text-sm font-medium text-foreground" htmlFor="trip-date">{isRTL ? 'تاريخ الرحلة' : 'Trip Date'} *</label>
                <input
                  id="trip-date"
                  type="date"
                  value={tripDate}
                  onChange={(e) => setTripDate(e.target.value)}
                  className="mt-1 w-full border border-input rounded-md px-3 py-2 text-sm bg-background text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                  dir="ltr"
                  lang={isRTL ? 'ar-SA-u-ca-gregory-nu-latn' : 'en-GB'}
                />
              </div>

              {formError && <p className="text-sm text-destructive" role="alert">{formError}</p>}

              <div className="flex gap-3">
                <Button
                  onClick={handleCreate}
                  disabled={!driverId || !vehicleId || !facilityId || !wasteStream || saving}
                  aria-busy={saving}
                  className="gap-2"
                >
                  {saving && <Loader2Icon className="w-4 h-4 animate-spin" />}
                  {isRTL ? 'إنشاء' : 'Create'}
                </Button>
                <Button variant="outline" onClick={() => setShowCreate(false)}>
                  {isRTL ? 'إلغاء' : 'Cancel'}
                </Button>
              </div>
          </div>
        </Modal>
      )}

      {managingTrip && (
        <Modal
          open
          onClose={() => setManagingTrip(null)}
          isRTL={isRTL}
          title={isRTL ? 'طلبات الالتقاط ضمن الرحلة' : 'Pickup Requests in this Trip'}
        >
          <div className="space-y-6">
            {manageLoading ? (
              <LoadingState label={isRTL ? 'جارٍ التحميل' : 'Loading'} />
            ) : (
              <>
                <div>
                  <h4 className="text-sm font-semibold text-foreground mb-2">
                    {isRTL ? 'مضمّنة في هذه الرحلة' : 'Included in this trip'} ({linkedAssignments.length})
                  </h4>
                  {linkedAssignments.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      {isRTL ? 'لم تُضَف أي طلبات بعد' : 'No requests added yet'}
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {linkedAssignments.map((a) => (
                        <div key={a.id} className="flex items-center justify-between gap-3 p-2 rounded-md border border-border">
                          <span className="text-sm text-foreground" dir="ltr">{formatDateTime(a.scheduled_at, isRTL)}</span>
                          <Button
                            size="sm" variant="ghost" className="text-destructive gap-1"
                            disabled={manageBusyId === a.id}
                            onClick={() => handleUnlink(a.id)}
                          >
                            <Link2OffIcon className="w-4 h-4" />
                            {isRTL ? 'إزالة' : 'Remove'}
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div>
                  <h4 className="text-sm font-semibold text-foreground mb-2">
                    {isRTL ? 'طلبات التقاط غير مضمّنة بعد' : 'Unlinked pickup requests'} ({unlinkedAssignments.length})
                  </h4>
                  {unlinkedAssignments.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      {isRTL ? 'لا توجد طلبات التقاط بانتظار التجميع' : 'No pending requests to group'}
                    </p>
                  ) : (
                    <div className="space-y-2 max-h-64 overflow-y-auto">
                      {unlinkedAssignments.map((a) => (
                        <div key={a.id} className="flex items-center justify-between gap-3 p-2 rounded-md border border-border">
                          <span className="text-sm text-foreground" dir="ltr">{formatDateTime(a.scheduled_at, isRTL)}</span>
                          <Button
                            size="sm" variant="outline" className="gap-1"
                            disabled={manageBusyId === a.id}
                            onClick={() => handleLink(a.id)}
                          >
                            <LinkIcon className="w-4 h-4" />
                            {isRTL ? 'إضافة' : 'Add'}
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
            <Button variant="outline" onClick={() => setManagingTrip(null)} className="w-full">
              {isRTL ? 'إغلاق' : 'Close'}
            </Button>
          </div>
        </Modal>
      )}
    </AppShell>
  );
}
