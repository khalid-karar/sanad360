import { useState } from 'react';
import { useAuthStore } from '../../stores/authStore';
import { usePWA } from '../../hooks/usePWA';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DownloadIcon, XIcon, SmartphoneIcon, MonitorIcon } from 'lucide-react';

export default function PWAInstallPrompt() {
  const { isRTL } = useAuthStore();
  const { isInstallable, installApp } = usePWA();
  const [isVisible, setIsVisible] = useState(true);
  const [isInstalling, setIsInstalling] = useState(false);

  if (!isInstallable || !isVisible) {
    return null;
  }

  const handleInstall = async () => {
    setIsInstalling(true);
    
    try {
      const success = await installApp();
      if (success) {
        setIsVisible(false);
      }
    } catch (error) {
      console.error('Failed to install app:', error);
    } finally {
      setIsInstalling(false);
    }
  };

  const handleDismiss = () => {
    setIsVisible(false);
    // Remember dismissal for this session
    sessionStorage.setItem('pwa-install-dismissed', 'true');
  };

  return (
    <div className="fixed bottom-4 left-4 right-4 z-50 max-w-sm mx-auto">
      <Card className="bg-card/95 backdrop-blur-sm text-card-foreground border-border shadow-strong animate-in slide-in-from-bottom-full duration-500">
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-gradient-primary rounded-xl flex items-center justify-center">
                <SmartphoneIcon className="w-5 h-5 text-primary-foreground" />
              </div>
              <CardTitle className="text-lg text-foreground">
                {isRTL ? 'تثبيت التطبيق' : 'Install App'}
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
              ? 'احصل على تجربة أفضل مع التطبيق المثبت على جهازك'
              : 'Get a better experience with the app installed on your device'
            }
          </p>

          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <div className="flex items-center gap-1">
              <MonitorIcon className="w-3 h-3" />
              <span>{isRTL ? 'وضع عدم الاتصال' : 'Offline Mode'}</span>
            </div>
            <div className="flex items-center gap-1">
              <SmartphoneIcon className="w-3 h-3" />
              <span>{isRTL ? 'إشعارات فورية' : 'Push Notifications'}</span>
            </div>
          </div>

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
              onClick={handleInstall}
              disabled={isInstalling}
              className="flex-1 bg-primary text-primary-foreground hover:bg-primary/90"
              size="sm"
            >
              <DownloadIcon className="w-4 h-4 me-2" />
              {isInstalling 
                ? (isRTL ? 'جاري التثبيت...' : 'Installing...')
                : (isRTL ? 'تثبيت' : 'Install')
              }
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
