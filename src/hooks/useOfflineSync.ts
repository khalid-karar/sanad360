import { useState, useEffect } from 'react';
import { useAuthStore } from '../stores/authStore';
import { useNotificationStore } from '../stores/notificationStore';
import { offlineStorage, getPendingSync } from '../utils/offlineStorage';

interface UseOfflineSyncReturn {
  pendingCount: number;
  issyncing: boolean;
  syncNow: () => Promise<void>;
  saveForLater: (type: 'compliance' | 'pickup' | 'driver' | 'vehicle', data: any) => Promise<string>;
}

export function useOfflineSync(): UseOfflineSyncReturn {
  const { user } = useAuthStore();
  const { addNotification } = useNotificationStore();
  const [pendingCount, setPendingCount] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);

  useEffect(() => {
    // Initialize offline storage
    offlineStorage.init().catch(console.error);
    
    // Update pending count
    updatePendingCount();
    
    // Set up periodic sync check
    const interval = setInterval(updatePendingCount, 30000); // Every 30 seconds
    
    return () => clearInterval(interval);
  }, []);

  const updatePendingCount = async () => {
    try {
      const pending = await getPendingSync();
      setPendingCount(pending.length);
    } catch (error) {
      console.error('Failed to get pending sync count:', error);
    }
  };

  const syncNow = async (): Promise<void> => {
    if (!navigator.onLine) {
      addNotification({
        type: 'warning',
        priority: 'medium',
        title: 'غير متصل بالإنترنت',
        titleEn: 'No Internet Connection',
        message: 'يرجى التحقق من اتصال الإنترنت والمحاولة مرة أخرى',
        messageEn: 'Please check your internet connection and try again',
        role: user?.role,
        autoHide: true,
        duration: 5000,
      });
      return;
    }

    setIsSyncing(true);

    try {
      const pendingData = await getPendingSync();
      let syncedCount = 0;

      for (const item of pendingData) {
        try {
          // Mock API call - in real app, this would be actual API endpoints
          const response = await mockApiCall(item.type, item.data);
          
          if (response.ok) {
            await offlineStorage.markAsSynced(item.id);
            syncedCount++;
          }
        } catch (error) {
          console.error(`Failed to sync ${item.type}:`, error);
        }
      }

      if (syncedCount > 0) {
        addNotification({
          type: 'success',
          priority: 'medium',
          title: 'تمت المزامنة بنجاح',
          titleEn: 'Sync Completed',
          message: `تم مزامنة ${syncedCount} عنصر بنجاح`,
          messageEn: `Successfully synced ${syncedCount} items`,
          role: user?.role,
          autoHide: true,
          duration: 4000,
        });

        // Clean up synced data
        await offlineStorage.clearSyncedData();
      }

      await updatePendingCount();
    } catch (error) {
      console.error('Sync failed:', error);
      
      addNotification({
        type: 'error',
        priority: 'high',
        title: 'فشل في المزامنة',
        titleEn: 'Sync Failed',
        message: 'حدث خطأ أثناء مزامنة البيانات',
        messageEn: 'An error occurred while syncing data',
        role: user?.role,
        autoHide: true,
        duration: 6000,
      });
    } finally {
      setIsSyncing(false);
    }
  };

  const saveForLater = async (type: 'compliance' | 'pickup' | 'driver' | 'vehicle', data: any): Promise<string> => {
    try {
      const id = await offlineStorage.saveData(type, data);
      
      addNotification({
        type: 'info',
        priority: 'low',
        title: 'تم الحفظ محلياً',
        titleEn: 'Saved Locally',
        message: 'سيتم إرسال البيانات عند العودة للإنترنت',
        messageEn: 'Data will be sent when back online',
        role: user?.role,
        autoHide: true,
        duration: 3000,
      });

      await updatePendingCount();
      return id;
    } catch (error) {
      console.error('Failed to save offline data:', error);
      throw error;
    }
  };

  return {
    pendingCount,
    issyncing: isSyncing,
    syncNow,
    saveForLater
  };
}

// Mock API call function - replace with actual API calls
async function mockApiCall(type: string, _data: unknown): Promise<{ ok: boolean }> {
  // Simulate network delay
  await new Promise(resolve => setTimeout(resolve, 1000 + Math.random() * 2000));
  
  // Simulate success/failure
  const success = Math.random() > 0.1; // 90% success rate
  
  console.log(`Mock API call for ${type}:`, success ? 'Success' : 'Failed');
  
  return { ok: success };
}
