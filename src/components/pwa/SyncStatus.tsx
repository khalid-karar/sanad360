import { useAuthStore } from '../../stores/authStore';
import { useOfflineSync } from '../../hooks/useOfflineSync';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { LoadingSpinner } from '@/components/ui/loading-spinner';
import { RefreshCwIcon, CloudOffIcon } from 'lucide-react';

export default function SyncStatus() {
  const { isRTL } = useAuthStore();
  const { pendingCount, issyncing, syncNow } = useOfflineSync();

  if (pendingCount === 0) {
    return null;
  }

  return (
    <div className="fixed bottom-4 right-4 z-40">
      <div className="flex items-center gap-3 bg-card/95 backdrop-blur-sm border border-border rounded-xl px-4 py-3 shadow-medium">
        <div className="flex items-center gap-2">
          <CloudOffIcon className="w-4 h-4 text-warning" />
          <Badge variant="secondary" className="text-xs">
            {pendingCount} {isRTL ? 'في الانتظار' : 'pending'}
          </Badge>
        </div>
        
        <Button
          size="sm"
          onClick={syncNow}
          disabled={issyncing || !navigator.onLine}
          className="bg-primary text-primary-foreground hover:bg-primary/90"
        >
          {issyncing ? (
            <LoadingSpinner size="sm" className="me-2" />
          ) : (
            <RefreshCwIcon className="w-4 h-4 me-2" />
          )}
          {issyncing 
            ? (isRTL ? 'جاري المزامنة...' : 'Syncing...')
            : (isRTL ? 'مزامنة' : 'Sync')
          }
        </Button>
      </div>
    </div>
  );
}
