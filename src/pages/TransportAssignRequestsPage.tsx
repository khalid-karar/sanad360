import { useCallback, useEffect, useState } from 'react';
import { useAuthStore } from '../stores/authStore';
import AppShell from '../components/AppShell';
import {
  listUnassignedRequestsForTransport,
  assignDriverVehicle,
} from '../lib/api/assignments';
import { listDrivers } from '../lib/api/drivers';
import { listVehicles } from '../lib/api/vehicles';
import { getCompany, getBranch } from '../lib/api/companies';
import type { PickupAssignment, Driver, Vehicle } from '../lib/database.types';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { Loader2Icon, ClipboardListIcon } from 'lucide-react';
import { LoadingState, EmptyState, ErrorState } from '@/components/ui/states';
import { Modal } from '@/components/ui/modal';
import { formatDateTime } from '../lib/format';

interface RequestRow {
  assignment: PickupAssignment;
  companyName: string;
  branchName: string;
}

/**
 * Migration 044 (separation of duties): the company REQUESTS a pickup with
 * no driver/vehicle. This is the transport side's half — a linked
 * transporter's owner/manager/dispatcher picks ITS OWN driver + vehicle for
 * each still-unassigned request, moving it from 'requested' to 'pending'.
 * Server-validated (RLS + trigger): active company_transporters link,
 * driver/vehicle must belong to the caller's own fleet.
 */
export default function TransportAssignRequestsPage() {
  const { isRTL, user } = useAuthStore();
  const { toast } = useToast();
  const transportCompanyId = user?.transport_company_id ?? undefined;

  const [rows, setRows] = useState<RequestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [assigning, setAssigning] = useState<PickupAssignment | null>(null);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [driverId, setDriverId] = useState('');
  const [vehicleId, setVehicleId] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const assignments = await listUnassignedRequestsForTransport();
      const enriched = await Promise.all(
        assignments.map(async (assignment) => {
          const [company, branch] = await Promise.all([
            getCompany(assignment.company_id),
            getBranch(assignment.branch_id),
          ]);
          return {
            assignment,
            companyName: company?.name_ar ?? '—',
            branchName: branch?.name_ar ?? '—',
          };
        })
      );
      setRows(enriched);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function openAssign(assignment: PickupAssignment) {
    if (!transportCompanyId) return;
    setAssigning(assignment);
    setDriverId('');
    setVehicleId('');
    setFormError(null);
    try {
      const [d, v] = await Promise.all([
        listDrivers(transportCompanyId),
        listVehicles(transportCompanyId),
      ]);
      setDrivers(d.filter((x) => x.status === 'active'));
      setVehicles(v.filter((x) => x.status === 'active'));
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to load fleet');
    }
  }

  async function handleAssign() {
    if (!assigning || !driverId || !vehicleId) return;
    setSaving(true);
    setFormError(null);
    try {
      await assignDriverVehicle(assigning.id, driverId, vehicleId);
      toast({ title: isRTL ? 'تم إسناد الطلب' : 'Request assigned' });
      setAssigning(null);
      await load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to assign');
    } finally {
      setSaving(false);
    }
  }

  return (
    <AppShell role="transport">
      <div className={`space-y-6 ${isRTL ? 'rtl' : 'ltr'}`}>
        <div>
          <h1 className="text-3xl font-bold text-foreground mb-1">
            {isRTL ? 'إسناد الطلبات' : 'Assign Requests'}
          </h1>
          <p className="text-muted-foreground">
            {isRTL
              ? 'أسند سائقك ومركبتك لطلبات الالتقاط الواردة من الشركات المرتبطة'
              : 'Assign your own driver and vehicle to requests from your linked companies'}
          </p>
        </div>

        {error && <ErrorState message={error} retry={load} retryLabel={isRTL ? 'إعادة المحاولة' : 'Retry'} />}

        {loading ? (
          <LoadingState label={isRTL ? 'جارٍ التحميل' : 'Loading'} />
        ) : rows.length === 0 && !error ? (
          <EmptyState
            icon={<ClipboardListIcon />}
            title={isRTL ? 'لا توجد طلبات بانتظار الإسناد' : 'No requests awaiting assignment'}
            hint={isRTL
              ? 'ستظهر هنا طلبات الالتقاط الجديدة من الشركات المرتبطة بك'
              : 'New pickup requests from your linked companies will appear here'}
          />
        ) : (
          <div className="space-y-3">
            {rows.map(({ assignment, companyName, branchName }) => (
              <Card key={assignment.id} className="bg-card text-card-foreground border-border">
                <CardContent className="pt-6 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-foreground">{companyName} — {branchName}</p>
                    <p className="text-xs text-muted-foreground mt-1" dir="ltr">
                      {formatDateTime(assignment.scheduled_at, isRTL)}
                    </p>
                    {assignment.notes && (
                      <p className="text-xs text-muted-foreground mt-1">{assignment.notes}</p>
                    )}
                  </div>
                  <Button size="sm" onClick={() => openAssign(assignment)} className="gap-2">
                    {isRTL ? 'إسناد سائق ومركبة' : 'Assign Driver & Vehicle'}
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {assigning && (
        <Modal
          open
          onClose={() => setAssigning(null)}
          isRTL={isRTL}
          maxWidth="max-w-md"
          title={isRTL ? 'إسناد سائق ومركبة' : 'Assign Driver & Vehicle'}
        >
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium text-foreground" htmlFor="assign-driver">
                {isRTL ? 'السائق' : 'Driver'} *
              </label>
              <select
                id="assign-driver"
                value={driverId}
                onChange={(e) => setDriverId(e.target.value)}
                className="mt-1 w-full border border-input rounded-md px-3 py-2 text-sm bg-background text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                <option value="">{isRTL ? 'اختر سائقاً' : 'Select a driver'}</option>
                {drivers.map((d) => <option key={d.id} value={d.id}>{d.name_ar}</option>)}
              </select>
            </div>
            <div>
              <label className="text-sm font-medium text-foreground" htmlFor="assign-vehicle">
                {isRTL ? 'المركبة' : 'Vehicle'} *
              </label>
              <select
                id="assign-vehicle"
                value={vehicleId}
                onChange={(e) => setVehicleId(e.target.value)}
                className="mt-1 w-full border border-input rounded-md px-3 py-2 text-sm bg-background text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                <option value="">{isRTL ? 'اختر مركبة' : 'Select a vehicle'}</option>
                {vehicles.map((v) => <option key={v.id} value={v.id}>{v.plate_number}</option>)}
              </select>
            </div>

            {formError && <p className="text-sm text-destructive" role="alert">{formError}</p>}

            <div className="flex gap-3">
              <Button
                onClick={handleAssign}
                disabled={!driverId || !vehicleId || saving}
                aria-busy={saving}
                className="gap-2"
              >
                {saving && <Loader2Icon className="w-4 h-4 animate-spin" />}
                {isRTL ? 'إسناد' : 'Assign'}
              </Button>
              <Button variant="outline" onClick={() => setAssigning(null)}>
                {isRTL ? 'إلغاء' : 'Cancel'}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </AppShell>
  );
}
