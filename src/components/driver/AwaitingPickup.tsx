import { useAuthStore } from '../../stores/authStore';
import { useDriverStore } from '../../stores/driverStore';
import type { Pickup } from '../../stores/driverStore';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { MapPinIcon, ClockIcon, Trash2Icon } from 'lucide-react';
import StaggeredList from '../animations/StaggeredList';
import FadeInUp from '../animations/FadeInUp';
import InteractiveButton from '../animations/InteractiveButton';

export default function AwaitingPickup() {
  const { isRTL } = useAuthStore();
  const { pickups, setCurrentPickup, setPickupState } = useDriverStore();

  const handleStartPickup = (pickup: Pickup) => {
    setCurrentPickup(pickup);
    // Go to QR scan first, then geolocation
    setPickupState('qr-scan');
  };

  return (
    <div className="space-y-6">
      <FadeInUp>
        <div>
          <h1 className="text-3xl font-bold text-foreground mb-2">
            {isRTL ? 'جدول اليوم' : "Today's Schedule"}
          </h1>
          <p className="text-muted-foreground">
            {isRTL ? 'قائمة الالتقاطات المجدولة لليوم' : 'Scheduled pickups for today'}
          </p>
        </div>
      </FadeInUp>

      <StaggeredList staggerDelay={0.1}>
        {pickups.map((pickup) => (
          <Card
            key={pickup.id}
            className={`bg-card text-card-foreground border-border ${
              pickup.completed ? 'opacity-50' : ''
            }`}
          >
            <CardHeader className="pb-3">
              <CardTitle className="text-base text-foreground flex items-center justify-between">
                <span>{pickup.company}</span>
                {pickup.completed && (
                  <span className="text-xs font-normal text-success">
                    {isRTL ? '✓ مكتمل' : '✓ Completed'}
                  </span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-2">
                <div className="flex items-start gap-2">
                  <MapPinIcon className="w-4 h-4 text-muted-foreground mt-1 flex-shrink-0" />
                  <p className="text-xs text-foreground">{pickup.address}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Trash2Icon className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                  <p className="text-xs text-foreground">{pickup.wasteType}</p>
                </div>
                <div className="flex items-center gap-2">
                  <ClockIcon className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                  <p className="text-xs text-foreground">{pickup.time}</p>
                </div>
              </div>

              <InteractiveButton
                disabled={pickup.completed}
                onClick={() => handleStartPickup(pickup)}
                className="w-full bg-muted text-muted-foreground hover:bg-muted/80 disabled:opacity-50"
                hapticFeedback
                size="sm"
              >
                {isRTL ? 'بدء الالتقاط' : 'Start Pickup'}
              </InteractiveButton>
            </CardContent>
          </Card>
        ))}

        {pickups.length === 0 && (
          <Card className="bg-card text-card-foreground border-border">
            <CardContent className="pt-8 pb-8 text-center">
              <p className="text-muted-foreground">
                {isRTL ? 'لا توجد التقاطات مجدولة اليوم' : 'No pickups scheduled for today'}
              </p>
            </CardContent>
          </Card>
        )}
      </StaggeredList>
    </div>
  );
}
