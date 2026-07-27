import { useEffect, useState } from 'react';
import { useAuthStore } from '../../stores/authStore';
import { formatDateTime } from '../../lib/format';
import { useDriverStore } from '../../stores/driverStore';
import type { AssignmentView } from '../../stores/driverStore';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { MapPinIcon, ClockIcon, TruckIcon } from 'lucide-react';
import { StatusBadge } from '../schedule/statusBadge';
import { LoadingState, EmptyState } from '@/components/ui/states';
import StaggeredList from '../animations/StaggeredList';
import FadeInUp from '../animations/FadeInUp';
import InteractiveButton from '../animations/InteractiveButton';

export default function AwaitingPickup() {
  const { isRTL } = useAuthStore();
  const {
    assignments,
    assignmentsLoading,
    assignmentsError,
    loadAssignments,
    beginPickup,
  } = useDriverStore();
  const [startingId, setStartingId] = useState<string | null>(null);
  const [startError, setStartError] = useState<string | null>(null);

  useEffect(() => {
    loadAssignments();
  }, [loadAssignments]);

  const handleStartPickup = async (view: AssignmentView) => {
    setStartingId(view.assignment.id);
    setStartError(null);
    try {
      await beginPickup(view.assignment);
    } catch (err) {
      setStartError(err instanceof Error ? err.message : 'Failed to start pickup');
    } finally {
      setStartingId(null);
    }
  };

  return (
    <div className="space-y-6">
      <FadeInUp>
        <div>
          <h1 className="text-3xl font-bold text-foreground mb-2">
            {isRTL ? 'مهام الالتقاط' : 'Pickup Assignments'}
          </h1>
          <p className="text-muted-foreground">
            {isRTL ? 'المهام المسندة إليك من المنشآت' : 'Assignments dispatched to you'}
          </p>
        </div>
      </FadeInUp>

      {(assignmentsError || startError) && (
        <p className="text-sm text-destructive" role="alert">{startError ?? assignmentsError}</p>
      )}

      {assignmentsLoading ? (
        <LoadingState label={isRTL ? 'جارٍ التحميل' : 'Loading'} />
      ) : (
        <StaggeredList staggerDelay={0.1}>
          {assignments.map((view) => (
            <Card key={view.assignment.id} className="bg-card text-card-foreground border-border">
              <CardHeader className="pb-3">
                <CardTitle className="text-base text-foreground flex items-center justify-between">
                  <span>{view.companyName} — {view.branchName}</span>
                  <StatusBadge status={view.assignment.status} isRTL={isRTL} />
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-2">
                  {view.branchAddress && (
                    <div className="flex items-start gap-2">
                      <MapPinIcon className="w-4 h-4 text-muted-foreground mt-1 flex-shrink-0" />
                      <p className="text-xs text-foreground">{view.branchAddress}</p>
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    <ClockIcon className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                    <p className="text-xs text-foreground" dir="ltr">
                      {formatDateTime(view.assignment.scheduled_at, isRTL)}
                    </p>
                  </div>
                  {view.assignment.notes && (
                    <p className="text-xs text-muted-foreground">{view.assignment.notes}</p>
                  )}
                </div>

                <InteractiveButton
                  disabled={startingId !== null}
                  onClick={() => handleStartPickup(view)}
                  className="w-full bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                  hapticFeedback
                  size="sm"
                >
                  {startingId === view.assignment.id
                    ? (isRTL ? 'جارٍ البدء...' : 'Starting...')
                    : view.assignment.status === 'in_progress'
                    ? (isRTL ? 'متابعة الالتقاط' : 'Continue Pickup')
                    : (isRTL ? 'بدء الالتقاط' : 'Start Pickup')}
                </InteractiveButton>
              </CardContent>
            </Card>
          ))}

          {assignments.length === 0 && !assignmentsError && (
            <EmptyState
              icon={<TruckIcon />}
              title={isRTL ? 'لا توجد مهام التقاط حالياً' : 'No pickup assignments right now'}
              hint={isRTL
                ? 'عندما يُسند إليك التقاط سيظهر هنا ويصلك إشعار — تحقق من صفحة "تأكيد التسليم" إن كانت لديك حمولات لم تُسلَّم بعد'
                : 'New pickups appear here with a notification — check the Deliveries page if you still have loads to hand over'}
            />
          )}
        </StaggeredList>
      )}
    </div>
  );
}
