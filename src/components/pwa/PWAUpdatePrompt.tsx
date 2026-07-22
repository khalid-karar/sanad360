import { useState, useEffect } from 'react';
import { useAuthStore } from '../../stores/authStore';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { RefreshCwIcon, XIcon, DownloadIcon } from 'lucide-react';

export default function PWAUpdatePrompt() {
  const { isRTL } = useAuthStore();
  const [showUpdatePrompt, setShowUpdatePrompt] = useState(false);
  const [waitingWorker, setWaitingWorker] = useState<ServiceWorker | null>(null);

  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        console.log('PWA: Controller changed, reloading page');
        window.location.reload();
      });

      navigator.serviceWorker.ready.then((registration) => {
        registration.addEventListener('updatefound', () => {
          console.log('PWA: Update found');
          const newWorker = registration.installing;
          
          if (newWorker) {
            newWorker.addEventListener('statechange', () => {
              if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                console.log('PWA: New version available');
                setWaitingWorker(newWorker);
                setShowUpdatePrompt(true);
              }
            });
          }
        });

        // Check if there's already a waiting worker
        if (registration.waiting) {
          setWaitingWorker(registration.waiting);
          setShowUpdatePrompt(true);
        }
      });
    }
  }, []);

  const handleUpdate = () => {
    if (waitingWorker) {
      waitingWorker.postMessage({ type: 'SKIP_WAITING' });
      setShowUpdatePrompt(false);
    }
  };

  const handleDismiss = () => {
    setShowUpdatePrompt(false);
  };

  if (!showUpdatePrompt) {
    return null;
  }

  return (
    <div className="fixed top-4 left-1/2 transform -translate-x-1/2 z-50 max-w-sm">
      <Card className="bg-card/95 backdrop-blur-sm text-card-foreground border-border shadow-strong animate-in slide-in-from-top-full duration-500">
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-gradient-primary rounded-xl flex items-center justify-center">
                <DownloadIcon className="w-5 h-5 text-primary-foreground" />
              </div>
              <CardTitle className="text-lg text-foreground">
                {isRTL ? 'تحديث متاح' : 'Update Available'}
              </CardTitle>
            </div>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={handleDismiss}
              className="text-muted-foreground hover:text-foreground"
            >
              <XIcon className="w-4 h-4" />
            </Button>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {isRTL 
              ? 'يتوفر إصدار جديد من التطبيق مع تحسينات وميزات جديدة'
              : 'A new version of the app is available with improvements and new features'
            }
          </p>

          <div className="flex gap-3">
            <Button
              variant="outline"
              onClick={handleDismiss}
              className="flex-1"
              size="sm"
            >
              {isRTL ? 'لاحقاً' : 'Later'}
            </Button>
            <Button
              onClick={handleUpdate}
              className="flex-1 bg-primary text-primary-foreground hover:bg-primary/90"
              size="sm"
            >
              <RefreshCwIcon className="w-4 h-4 me-2" />
              {isRTL ? 'تحديث الآن' : 'Update Now'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
