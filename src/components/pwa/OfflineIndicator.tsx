import { useAuthStore } from '../../stores/authStore';
import { usePWA } from '../../hooks/usePWA';
import { Badge } from '@/components/ui/badge';
import { WifiOffIcon, WifiIcon } from 'lucide-react';

export default function OfflineIndicator() {
  const { isRTL } = useAuthStore();
  const { isOffline } = usePWA();

  if (!isOffline) {
    return null;
  }

  return (
    <div className="fixed top-4 left-1/2 transform -translate-x-1/2 z-40">
      <Badge 
        variant="destructive" 
        className="flex items-center gap-2 px-4 py-2 text-sm font-medium shadow-medium animate-in slide-in-from-top-full duration-300"
      >
        <WifiOffIcon className="w-4 h-4" />
        <span>{isRTL ? 'وضع عدم الاتصال' : 'Offline Mode'}</span>
      </Badge>
    </div>
  );
}
