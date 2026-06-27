import { useAuthStore } from '../../stores/authStore';
import { useDriverStore } from '../../stores/driverStore';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { CheckCircle2Icon, LoaderIcon, AlertTriangleIcon } from 'lucide-react';
import { useEffect } from 'react';

export default function PickupConfirmation() {
  const { isRTL } = useAuthStore();
  const { completePickup, resetFlow, isSubmitting, submitError, clearSubmitError } = useDriverStore();

  // Trigger the API call as soon as this screen mounts
  useEffect(() => {
    completePickup();
  // We only want this to run once on mount
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleReturn = () => {
    clearSubmitError();
    resetFlow();
  };

  const handleRetry = () => {
    clearSubmitError();
    completePickup();
  };

  return (
    <div className="space-y-6 max-w-2xl mx-auto flex items-center justify-center min-h-[60vh]">
      <Card className="bg-card text-card-foreground border-border w-full">
        <CardContent className="pt-12 pb-12 space-y-8">

          {/* Submitting */}
          {isSubmitting && (
            <>
              <div className="flex justify-center">
                <div className="w-32 h-32 bg-primary/10 rounded-full flex items-center justify-center">
                  <LoaderIcon className="w-16 h-16 text-primary animate-spin" />
                </div>
              </div>
              <div className="text-center space-y-2">
                <h2 className="text-2xl font-bold text-foreground">
                  {isRTL ? 'جارٍ الحفظ...' : 'Saving...'}
                </h2>
                <p className="text-muted-foreground">
                  {isRTL ? 'يتم رفع الأدلة وحفظ السجل' : 'Uploading evidence and saving record'}
                </p>
              </div>
            </>
          )}

          {/* Error */}
          {!isSubmitting && submitError && (
            <>
              <div className="flex justify-center">
                <div className="w-32 h-32 bg-destructive/10 rounded-full flex items-center justify-center">
                  <AlertTriangleIcon className="w-16 h-16 text-destructive" />
                </div>
              </div>
              <div className="text-center space-y-4">
                <h2 className="text-2xl font-bold text-foreground">
                  {isRTL ? 'حدث خطأ' : 'Submission Failed'}
                </h2>
                <p className="text-sm text-destructive">{submitError}</p>
              </div>
              <div className="flex gap-3">
                <Button
                  variant="outline"
                  onClick={handleReturn}
                  className="flex-1 bg-background text-foreground border-border hover:bg-accent"
                >
                  {isRTL ? 'إلغاء' : 'Cancel'}
                </Button>
                <Button
                  onClick={handleRetry}
                  className="flex-1 bg-primary text-primary-foreground hover:bg-primary/90"
                >
                  {isRTL ? 'إعادة المحاولة' : 'Retry'}
                </Button>
              </div>
            </>
          )}

          {/* Success */}
          {!isSubmitting && !submitError && (
            <>
              <div className="flex justify-center">
                <div className="w-32 h-32 bg-success/10 rounded-full flex items-center justify-center animate-pulse">
                  <CheckCircle2Icon className="w-16 h-16 text-success" />
                </div>
              </div>
              <div className="text-center space-y-4">
                <h2 className="text-3xl font-bold text-foreground">
                  {isRTL ? 'تم بنجاح!' : 'Success!'}
                </h2>
                <p className="text-lg text-muted-foreground">
                  {isRTL ? 'تم حفظ البيان بشكل دائم' : 'Manifest permanently saved'}
                </p>
              </div>
              <Button
                onClick={handleReturn}
                className="w-full bg-primary text-primary-foreground hover:bg-primary/90"
              >
                {isRTL ? 'العودة للرئيسية' : 'Return to Dashboard'}
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
