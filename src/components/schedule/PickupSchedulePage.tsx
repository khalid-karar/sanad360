import { useCallback, useEffect, useState } from 'react';
import { useAuthStore } from '../../stores/authStore';
import AppShell from '../AppShell';
import {
  listAssignments,
  createAssignment,
  updateAssignmentStatus,
  getTransportCompanyForCompany,
} from '../../lib/api/assignments';
import { listBranches } from '../../lib/api/branches';
import { listDrivers } from '../../lib/api/drivers';
import { listVehicles } from '../../lib/api/vehicles';
import type { PickupAssignment, Branch, Driver, Vehicle } from '../../lib/database.types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2Icon, PlusIcon, XIcon } from 'lucide-react';
import { StatusBadge } from './statusBadge';

export default function PickupSchedulePage() {
  const { isRTL, user } = useAuthStore();
  const companyId = user?.company_id ?? undefined;

  const [assignments, setAssignments] = useState<PickupAssignment[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  // Form state
  const [branchId, setBranchId] = useState('');
  const [driverId, setDriverId] = useState('');
  const [vehicleId, setVehicleId] = useState('');
  const [scheduledAt, setScheduledAt] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const reload = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    setError(null);
    try {
      const list = await listAssignments({ companyId });
      setAssignments(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => {
    reload();
  }, [reload]);

  // Load dropdown data when the form opens.
  useEffect(() => {
    if (!showForm || !companyId) return;
    let cancelled = false;
    (async () => {
      try {
        const branchList = await listBranches(companyId);
        const transportCompanyId = await getTransportCompanyForCompany(companyId);
        const [driverList, vehicleList] = transportCompanyId
          ? await Promise.all([listDrivers(transportCompanyId), listVehicles(transportCompanyId)])
          : [[], []];
        if (cancelled) return;
        setBranches(branchList.filter((b) => b.status === 'active'));
        setDrivers(driverList.filter((d) => d.status === 'active'));
        setVehicles(vehicleList.filter((v) => v.status === 'active'));
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load options');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [showForm, companyId]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!companyId) return;
    setSubmitting(true);
    setError(null);
    try {
      await createAssignment({
        company_id: companyId,
        branch_id: branchId,
        driver_id: driverId,
        vehicle_id: vehicleId,
        scheduled_at: new Date(scheduledAt).toISOString(),
        notes: notes || undefined,
        created_by: user?.id,
      });
      setShowForm(false);
      setBranchId('');
      setDriverId('');
      setVehicleId('');
      setScheduledAt('');
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
          <Button onClick={() => setShowForm(true)} className="gap-2">
            <PlusIcon className="w-4 h-4" />
            {isRTL ? 'جدولة التقاط' : 'Schedule Pickup'}
          </Button>
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

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
                        <td className="p-3 text-sm text-foreground">{driverName(a.driver_id)}</td>
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
                  <input
                    type="datetime-local"
                    value={scheduledAt}
                    onChange={(e) => setScheduledAt(e.target.value)}
                    required
                    dir="ltr"
                    className="mt-1 w-full border border-input rounded-md px-3 py-2 text-sm bg-background text-foreground"
                  />
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
