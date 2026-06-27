import { useState } from 'react';
import { useAuthStore } from '../../stores/authStore';
import { useNotificationStore } from '../../stores/notificationStore';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { BellIcon } from 'lucide-react';
import NotificationCenter from './NotificationCenter';

export default function NotificationBell() {
  const { user } = useAuthStore();
  const { unreadCount, getNotificationsByRole } = useNotificationStore();
  const [isOpen, setIsOpen] = useState(false);

  const roleNotifications = getNotificationsByRole(user?.role || '');
  const roleUnreadCount = roleNotifications.filter(n => !n.read).length;

  return (
    <>
      <div className="relative">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setIsOpen(true)}
          className="relative text-foreground hover:text-foreground hover:bg-accent"
        >
          <BellIcon className="w-5 h-5" />
          {roleUnreadCount > 0 && (
            <Badge 
              variant="destructive" 
              className="absolute -top-1 -right-1 h-5 w-5 flex items-center justify-center text-xs p-0 min-w-[20px]"
            >
              {roleUnreadCount > 99 ? '99+' : roleUnreadCount}
            </Badge>
          )}
        </Button>
      </div>

      <NotificationCenter 
        isOpen={isOpen} 
        onClose={() => setIsOpen(false)} 
      />
    </>
  );
}
