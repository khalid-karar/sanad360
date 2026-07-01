import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../stores/authStore';
import { useDriverStore } from '../../stores/driverStore';
import AppShell from '../AppShell';
import { listAssignments, updateAssignmentStatus } from '../../lib/api/assignments';
import type { PickupAssignment } from '../../lib/database.types';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2Icon } from 'lucide-react';
import { StatusBadge } from './statusBadge';

export default function MySchedulePage() {
  const { isRTL, user } = useAuthStore();
  const beginPickup = useDriverStore((s) => s.beginPickup);
  const navigate = useNavigate();
  const driverRecordId = user?.driver_record_id ?? undefined;

  const [assignments, setAssignments] = useState<PickupAssignment[]>([]);
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
                      <Button size="sm" disabled={busyId !== null} onClick={() => transition(a.id, 'accepted')}>
                        {isRTL ? 'قبول' : 'Accept'}
                      </Button>
                    )}
                    {(a.status === 'accepted' || a.status === 'in_progress') && (
                      <Button size="sm" disabled={busyId !== null} onClick={() => startEvidenceFlow(a)}>
                        {busyId === a.id && <Loader2Icon className="w-4 h-4 animate-spin mr-1" />}
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
