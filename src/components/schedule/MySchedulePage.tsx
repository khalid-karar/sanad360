import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../stores/authStore';
import { useDriverStore } from '../../stores/driverStore';
import AppShell from '../AppShell';
import { listAssignments, updateAssignmentStatus } from '../../lib/api/assignments';
import { getBranch, getCompany } from '../../lib/api/companies';
import type { PickupAssignment } from '../../lib/database.types';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2Icon, MapPinIcon, CalendarClockIcon } from 'lucide-react';
import { StatusBadge } from './statusBadge';
import { LoadingState, EmptyState } from '@/components/ui/states';

/** Destination info a field driver needs at a glance (P0-2). */
interface Destination {
  companyName: string;
  branchName: string;
  address: string;
}

export default function MySchedulePage() {
  const { isRTL, user } = useAuthStore();
  const beginPickup = useDriverStore((s) => s.beginPickup);
  const navigate = useNavigate();
  const driverRecordId = user?.driver_record_id ?? undefined;

  const [assignments, setAssignments] = useState<PickupAssignment[]>([]);
  const [destinations, setDestinations] = useState<Record<string, Destination>>({});
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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

      // Destination display data (branch/company names via the 009
      // linked-transporter read) — the card must answer "where do I go?".
      const branchIds = [...new Set(list.map((a) => a.branch_id))];
      const companyIds = [...new Set(list.map((a) => a.company_id))];
      const [branches, companies] = await Promise.all([
        Promise.all(branchIds.map((id) => getBranch(id).catch(() => null))),
        Promise.all(companyIds.map((id) => getCompany(id).catch(() => null))),
      ]);
      const branchMap = new Map(branches.filter(Boolean).map((b) => [b!.id, b!]));
      const companyMap = new Map(companies.filter(Boolean).map((c) => [c!.id, c!]));
      const dests: Record<string, Destination> = {};
      for (const a of list) {
        const b = branchMap.get(a.branch_id);
        const c = companyMap.get(a.company_id);
        dests[a.id] = {
          companyName: c?.name_ar ?? '—',
          branchName: b?.name_ar ?? '—',
          address: b?.address_ar ?? b?.city ?? '',
        };
      }
      setDestinations(dests);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [driverRecordId]);

  useEffect(() => {
    reload();
  }, [reload]);

  async function transition(id: string, status: 'accepted' | 'cancelled') {
    setBusyId(id);
    try {
      await updateAssignmentStatus(id, status);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update');
    } finally {
      setBusyId(null);
    }
  }

  /**
   * Completion goes through the FULL evidence flow (QR → GPS → manifest →
   * signature) on the driver dashboard — a pickup record without captured
   * evidence defeats the product. beginPickup flips the assignment to
   * in_progress and seeds the flow with its branch/company context.
   */
  async function startEvidenceFlow(a: PickupAssignment) {
    setBusyId(a.id);
    setError(null);
    try {
      await beginPickup(a);
      navigate('/driver');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start');
      setBusyId(null);
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

        {error && <p className="text-sm text-destructive">{error}</p>}

        {!driverRecordId ? (
          <p className="text-muted-foreground text-sm">
            {isRTL ? 'لا يوجد سجل سائق مرتبط بحسابك.' : 'No driver record linked to your account.'}
          </p>
        ) : loading ? (
          <LoadingState label={isRTL ? 'جارٍ التحميل' : 'Loading'} />
        ) : assignments.length === 0 ? (
          <EmptyState
            icon={<CalendarClockIcon />}
            title={isRTL ? 'لا توجد مهام مسندة إليك' : 'No assignments for you yet'}
            hint={isRTL
              ? 'عندما تُسند إليك مهمة التقاط ستظهر هنا وسيصلك إشعار — لا حاجة لأي إجراء الآن'
              : 'When a pickup is dispatched to you it appears here and you get a notification — nothing to do right now'}
          />
        ) : (
          <div className="space-y-3">
            {assignments.map((a) => (
              <Card key={a.id} className="bg-card text-card-foreground border-border">
                <CardContent className="pt-6 flex flex-wrap items-center justify-between gap-3">
                  <div className="space-y-1.5">
                    {/* Destination first — the field driver's #1 question */}
                    <p className="font-semibold text-foreground">
                      {destinations[a.id]?.companyName} — {destinations[a.id]?.branchName}
                    </p>
                    {destinations[a.id]?.address && (
                      <p className="text-xs text-foreground flex items-center gap-1.5">
                        <MapPinIcon className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" aria-hidden />
                        {destinations[a.id].address}
                      </p>
                    )}
                    <p className="text-sm text-muted-foreground" dir="ltr">
                      {new Date(a.scheduled_at).toLocaleString(isRTL ? 'ar-SA' : 'en-GB')}
                    </p>
                    {a.notes && <p className="text-xs text-muted-foreground">{a.notes}</p>}
                    <div className="pt-1">
                      <StatusBadge status={a.status} isRTL={isRTL} />
                    </div>
                  </div>
                  <div className="flex gap-2 flex-wrap">
                    {a.status === 'pending' && (
                      <Button size="sm" disabled={busyId !== null} onClick={() => transition(a.id, 'accepted')}>
                        {isRTL ? 'قبول' : 'Accept'}
                      </Button>
                    )}
                    {(a.status === 'accepted' || a.status === 'in_progress') && (
                      <Button size="sm" disabled={busyId !== null} onClick={() => startEvidenceFlow(a)}>
                        {busyId === a.id && <Loader2Icon className="w-4 h-4 animate-spin me-1" />}
                        {a.status === 'in_progress'
                          ? (isRTL ? 'متابعة الالتقاط' : 'Continue Pickup')
                          : (isRTL ? 'بدء الالتقاط' : 'Start Pickup')}
                      </Button>
                    )}
                    {(a.status === 'pending' || a.status === 'accepted') && (
                      <Button size="sm" variant="outline" disabled={busyId !== null} onClick={() => transition(a.id, 'cancelled')}>
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
    </AppShell>
  );
}
