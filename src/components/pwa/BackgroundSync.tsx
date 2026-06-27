import { useEffect } from 'react';
import { useAuthStore } from '../../stores/authStore';
import { useNotificationStore } from '../../stores/notificationStore';
import { usePWA } from '../../hooks/usePWA';

export default function BackgroundSync() {
  const { user } = useAuthStore();
  const { addNotification } = useNotificationStore();
  const { isOffline } = usePWA();

  useEffect(() => {
    // Register background sync when service worker is available
    if ('serviceWorker' in navigator && 'sync' in window.ServiceWorkerRegistration.prototype) {
      navigator.serviceWorker.ready.then((registration) => {
        console.log('PWA: Background sync registered');
        
        // Register sync events for different data types
        registration.sync.register('background-sync-compliance').catch((error) => {
          console.error('PWA: Failed to register compliance sync', error);
        });
        
        registration.sync.register('background-sync-pickups').catch((error) => {
          console.error('PWA: Failed to register pickup sync', error);
        });
      });
    }

    // Listen for online event to trigger sync
    const handleOnline = () => {
      console.log('PWA: Back online, triggering sync');
      
      // Notify user that sync is happening
      addNotification({
        type: 'info',
        priority: 'low',
        title: 'العودة للإنترنت',
        titleEn: 'Back Online',
        message: 'جاري مزامنة البيانات المحفوظة محلياً',
        messageEn: 'Syncing locally saved data',
        role: user?.role,
        autoHide: true,
        duration: 3000,
      });

      // Trigger background sync
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.ready.then((registration) => {
          registration.sync.register('background-sync-compliance');
          registration.sync.register('background-sync-pickups');
        });
      }
    };

    const handleOffline = () => {
      console.log('PWA: Gone offline');
      
      // Notify user about offline mode
      addNotification({
        type: 'warning',
        priority: 'medium',
        title: 'وضع عدم الاتصال',
        titleEn: 'Offline Mode',
        message: 'يمكنك الاستمرار في العمل. سيتم حفظ البيانات محلياً',
        messageEn: 'You can continue working. Data will be saved locally',
        role: user?.role,
        autoHide: true,
        duration: 5000,
      });
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [user?.role, addNotification]);

  // This component doesn't render anything visible
  return null;
}
