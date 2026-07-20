import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../stores/authStore';
import AppShell from '../AppShell';
import {
  listAssignments,
  createAssignment,
  updateAssignmentStatus,
} from '../../lib/api/assignments';
import { getDriversAndVehiclesForCompany } from '../../lib/api/companyTransporters';
import { listBranches } from '../../lib/api/branches';
import type { PickupAssignment, Branch, Driver, Vehicle } from '../../lib/database.types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2Icon, PlusIcon, XIcon, TruckIcon, MessageCircleIcon } from 'lucide-react';
import { StatusBadge } from './statusBadge';
import { DatePicker, DateTimePicker } from '@/components/ui/date-picker';
import { formatDateTime } from '../../lib/format';

export default function PickupSchedulePage() {
  const navigate = useNavigate();
  const { isRTL, user } = useAuthStore();
  const companyId = user?.company_id ?? undefined;

  const [assignments, setAssignments] = useState<PickupAssignment[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  // Whether the company has any active transporter that provides drivers/vehicles.
  const [hasTransporter, setHasTransporter] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  // Form state
  const [branchId, setBranchId] = useState('');
  const [driverId, setDriverId] = useState('');
  const [vehicleId, setVehicleId] = useState('');
  const [scheduledAt, setScheduledAt] = useState('');
  const [recurrence, setRecurrence] = useState<'none' | 'daily' | 'weekly'>('none');
  const [recurrenceUntil, setRecurrenceUntil] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const reload = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    setError(null);
    try {
      // Load assignments, branches and the transporter-derived driver/vehicle
      // pools together. getDriversAndVehiclesForCompany() resolves the company's
      // active company_transporters links (replacing the old most-recent-pickup
      // hack) and returns empty arrays when no transporter is linked.
      const [list, branchList, pool] = await Promise.all([
        listAssignments({ companyId }),
        listBranches(companyId),
        getDriversAndVehiclesForCompany(companyId),
      ]);
      setAssignments(list);
      setBranches(branchList.filter((b) => b.status === 'active'));
      setDrivers(pool.drivers);
      setVehicles(pool.vehicles);
      setHasTransporter(pool.drivers.length > 0 || pool.vehicles.length > 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => {
    reload();
  }, [reload]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!companyId) return;
    if (!scheduledAt) {
      setError(isRTL ? 'التاريخ والوقت مطلوبان' : 'Date & time are required');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await createAssignment({
        company_id: companyId,
        branch_id: branchId,
        driver_id: driverId,
        vehicle_id: vehicleId,
        scheduled_at: new Date(scheduledAt).toISOString(),
        recurrence,
        recurrence_until: recurrence !== 'none' && recurrenceUntil ? recurrenceUntil : undefined,
        notes: notes || undefined,
        created_by: user?.id,
      });
      setShowForm(false);
      setBranchId('');
      setDriverId('');
      setVehicleId('');
      setScheduledAt('');
      setRecurrence('none');
      setRecurrenceUntil('');
      setNotes('');
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to schedule');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCancel(id: string) {
    try {
      await updateAssignmentStatus(id, 'cancelled');
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to cancel');
    }
  }

  // wa.me needs country-format digits; normalize 05xxxxxxxx -> 9665xxxxxxxx.
  function driverPhone(id: string): string | null {
    const raw = drivers.find((d) => d.id === id)?.phone;
    if (!raw) return null;
    const digits = raw.replace(/\D/g, '');
    return digits.startsWith('0') ? `966${digits.slice(1)}` : digits;
  }

  function driverName(id: string): string {
    return drivers.find((d) => d.id === id)?.name_ar ?? id.slice(0, 8);
  }

  return (
    <AppShell role="company">
      <div className={`space-y-6 ${isRTL ? 'rtl' : 'ltr'}`}>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-foreground mb-1">
              {isRTL ? 'جدولة الالتقاطات' : 'Pickup Schedule'}
            </h1>
            <p className="text-muted-foreground">
              {isRTL ? 'إدارة مواعيد التقاط النفايات' : 'Manage waste pickup assignments'}
            </p>
          </div>
          {hasTransporter && (
            <Button onClick={() => setShowForm(true)} className="gap-2">
              <PlusIcon className="w-4 h-4" />
              {isRTL ? 'جدولة التقاط' : 'Schedule Pickup'}
            </Button>
          )}
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        {/* No active transporter linked → block scheduling and guide the user. */}
        {!loading && !hasTransporter ? (
          <Card className="bg-card text-card-foreground border-border">
            <CardContent className="py-12 flex flex-col items-center text-center gap-4">
              <TruckIcon className="w-10 h-10 text-muted-foreground" />
              <p className="text-foreground font-medium">
                {isRTL ? 'يرجى ربط شركة نقل أولاً' : 'Please link a transport company first'}
              </p>
              <Button onClick={() => navigate('/company/transporters')} className="gap-2">
                <TruckIcon className="w-4 h-4" />
                {isRTL ? 'الناقلون المعتمدون' : 'Approved Transporters'}
              </Button>
            </CardContent>
          </Card>
        ) : (
        <Card className="bg-card text-card-foreground border-border">
          <CardHeader>
            <CardTitle>{isRTL ? 'الالتقاطات المجدولة' : 'Scheduled Pickups'}</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex justify-center py-8">
                <Loader2Icon className="w-6 h-6 animate-spin text-primary" />
              </div>
            ) : assignments.length === 0 ? (
              <p className="text-muted-foreground text-sm py-6 text-center">
                {isRTL ? 'لا توجد التقاطات مجدولة' : 'No scheduled pickups yet'}
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-border text-start">
                      <th className="p-3 text-sm font-medium text-muted-foreground text-start">
                        {isRTL ? 'الموعد' : 'Scheduled'}
                      </th>
                      <th className="p-3 text-sm font-medium text-muted-foreground text-start">
                        {isRTL ? 'السائق' : 'Driver'}
                      </th>
                      <th className="p-3 text-sm font-medium text-muted-foreground text-start">
                        {isRTL ? 'الحالة' : 'Status'}
                      </th>
                      <th className="p-3 text-sm font-medium text-muted-foreground text-start"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {assignments.map((a) => (
                      <tr key={a.id} className="border-b border-border">
                        <td className="p-3 text-sm text-foreground" dir="ltr">
                          {new Date(a.scheduled_at).toLocaleString(isRTL ? 'ar-SA' : 'en-GB')}
                        </td>
                        <td className="p-3 text-sm text-foreground">
                          <span className="inline-flex items-center gap-2">
                            {driverName(a.driver_id)}
                            {driverPhone(a.driver_id) && (
                              <a
                                href={`https://wa.me/${driverPhone(a.driver_id)}?text=${encodeURIComponent(
                                  isRTL
                                    ? `بخصوص التقاط ${formatDateTime(a.scheduled_at, true)} — سند 360`
                                    : `Regarding the pickup on ${formatDateTime(a.scheduled_at, false)} — Sanad 360`
                                )}`}
                                target="_blank"
                                rel="noreferrer"
                                title={isRTL ? 'مراسلة السائق عبر واتساب' : 'Message driver on WhatsApp'}
                                aria-label={isRTL ? 'مراسلة السائق عبر واتساب' : 'Message driver on WhatsApp'}
                                className="text-success hover:opacity-80"
                              >
                                <MessageCircleIcon className="w-4 h-4" />
                              </a>
                            )}
                            {a.recurrence !== 'none' && (
                              <span className="text-[10px] rounded-full border border-border px-1.5 py-0.5 text-muted-foreground">
                                {a.recurrence === 'daily' ? (isRTL ? 'يومي' : 'daily') : (isRTL ? 'أسبوعي' : 'weekly')}
                              </span>
                            )}
                          </span>
                        </td>
                        <td className="p-3 text-sm">
                          <StatusBadge status={a.status} isRTL={isRTL} />
                        </td>
                        <td className="p-3 text-sm">
                          {a.status === 'pending' && (
                            <Button variant="outline" size="sm" onClick={() => handleCancel(a.id)}>
                              {isRTL ? 'إلغاء' : 'Cancel'}
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
        )}
      </div>

      {/* Schedule form modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/50 p-4">
          <Card className={`w-full max-w-md bg-card text-card-foreground border-border ${isRTL ? 'rtl' : 'ltr'}`}>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>{isRTL ? 'جدولة التقاط' : 'Schedule Pickup'}</CardTitle>
              <Button variant="ghost" size="icon" onClick={() => setShowForm(false)}>
                <XIcon className="w-5 h-5" />
              </Button>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleCreate} className="space-y-4">
                <div>
                  <label className="text-sm font-medium text-foreground">{isRTL ? 'الفرع' : 'Branch'} *</label>
                  <select
                    value={branchId}
                    onChange={(e) => setBranchId(e.target.value)}
                    required
                    className="mt-1 w-full border border-input rounded-md px-3 py-2 text-sm bg-background text-foreground"
                  >
                    <option value="">{isRTL ? 'اختر الفرع' : 'Select branch'}</option>
                    {branches.map((b) => (
                      <option key={b.id} value={b.id}>
                        {isRTL ? b.name_ar : b.name_en ?? b.name_ar}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-sm font-medium text-foreground">{isRTL ? 'السائق' : 'Driver'} *</label>
                  <select
                    value={driverId}
                    onChange={(e) => setDriverId(e.target.value)}
                    required
                    className="mt-1 w-full border border-input rounded-md px-3 py-2 text-sm bg-background text-foreground"
                  >
                    <option value="">{isRTL ? 'اختر السائق' : 'Select driver'}</option>
                    {drivers.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name_ar} — {d.license_number}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-sm font-medium text-foreground">{isRTL ? 'المركبة' : 'Vehicle'} *</label>
                  <select
                    value={vehicleId}
                    onChange={(e) => setVehicleId(e.target.value)}
                    required
                    className="mt-1 w-full border border-input rounded-md px-3 py-2 text-sm bg-background text-foreground"
                  >
                    <option value="">{isRTL ? 'اختر المركبة' : 'Select vehicle'}</option>
                    {vehicles.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.plate_number} — {v.type}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-sm font-medium text-foreground">
                    {isRTL ? 'التاريخ والوقت' : 'Date & Time'} *
                  </label>
                  <div className="mt-1">
                    <DateTimePicker value={scheduledAt} onChange={setScheduledAt} isRTL={isRTL} />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-sm font-medium text-foreground">
                      {isRTL ? 'التكرار' : 'Recurrence'}
                    </label>
                    <select
                      value={recurrence}
                      onChange={(e) => setRecurrence(e.target.value as 'none' | 'daily' | 'weekly')}
                      className="mt-1 w-full border border-input rounded-md px-3 py-2 text-sm bg-background text-foreground"
                    >
                      <option value="none">{isRTL ? 'بدون تكرار' : 'One-time'}</option>
                      <option value="daily">{isRTL ? 'يومي' : 'Daily'}</option>
                      <option value="weekly">{isRTL ? 'أسبوعي' : 'Weekly'}</option>
                    </select>
                  </div>
                  {recurrence !== 'none' && (
                    <div>
                      <label className="text-sm font-medium text-foreground">
                        {isRTL ? 'حتى تاريخ' : 'Repeat until'}
                      </label>
                      <div className="mt-1">
                        <DatePicker value={recurrenceUntil} onChange={setRecurrenceUntil} isRTL={isRTL} />
                      </div>
                    </div>
                  )}
                </div>

                <div>
                  <label className="text-sm font-medium text-foreground">{isRTL ? 'ملاحظات' : 'Notes'}</label>
                  <textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    rows={2}
                    className="mt-1 w-full border border-input rounded-md px-3 py-2 text-sm bg-background text-foreground"
                  />
                </div>

                {error && <p className="text-sm text-destructive">{error}</p>}

                <div className="flex gap-3">
                  <Button type="submit" disabled={submitting} className="gap-2">
                    {submitting && <Loader2Icon className="w-4 h-4 animate-spin" />}
                    {isRTL ? 'حفظ' : 'Save'}
                  </Button>
                  <Button type="button" variant="outline" onClick={() => setShowForm(false)}>
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
