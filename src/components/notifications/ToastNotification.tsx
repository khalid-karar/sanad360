import { useEffect, useState } from 'react';
import { useAuthStore } from '../../stores/authStore';
import { useNotificationStore, Notification } from '../../stores/notificationStore';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { 
  CheckCircle2Icon, 
  AlertTriangleIcon, 
  XCircleIcon, 
  InfoIcon, 
  XIcon 
} from 'lucide-react';

export default function ToastNotification() {
  const { isRTL, user } = useAuthStore();
  const { notifications, removeNotification, markAsRead } = useNotificationStore();
  const [visibleNotifications, setVisibleNotifications] = useState<Notification[]>([]);

  useEffect(() => {
    // Show only recent unread notifications for current user role
    const recentNotifications = notifications
      .filter(n => 
        !n.read && 
        (!n.role || n.role === user?.role) &&
        (Date.now() - n.timestamp.getTime()) < 10000 // Last 10 seconds
      )
      .slice(0, 3); // Max 3 toasts

    setVisibleNotifications(recentNotifications);
  }, [notifications, user?.role]);

  const getNotificationIcon = (type: Notification['type']) => {
    switch (type) {
      case 'success':
        return <CheckCircle2Icon className="w-5 h-5 text-success" />;
      case 'warning':
        return <AlertTriangleIcon className="w-5 h-5 text-warning" />;
      case 'error':
        return <XCircleIcon className="w-5 h-5 text-destructive" />;
      default:
        return <InfoIcon className="w-5 h-5 text-primary" />;
    }
  };

  const getNotificationStyles = (type: Notification['type']) => {
    switch (type) {
      case 'success':
        return 'bg-success/10 border-success/20';
      case 'warning':
        return 'bg-warning/10 border-warning/20';
      case 'error':
        return 'bg-destructive/10 border-destructive/20';
      default:
        return 'bg-primary/10 border-primary/20';
    }
  };

  const handleDismiss = (notification: Notification) => {
    markAsRead(notification.id);
    removeNotification(notification.id);
  };

  const handleAction = (notification: Notification) => {
    if (notification.onAction) {
      notification.onAction();
    }
    markAsRead(notification.id);
  };

  if (visibleNotifications.length === 0) return null;

  return (
    <div className="fixed top-4 right-4 z-50 space-y-3 max-w-sm">
      {visibleNotifications.map((notification, index) => (
        <Card
          key={notification.id}
          className={`border-2 shadow-lg animate-in slide-in-from-right-full duration-300 ${getNotificationStyles(notification.type)}`}
          style={{ animationDelay: `${index * 100}ms` }}
        >
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              {getNotificationIcon(notification.type)}
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="font-medium text-foreground text-sm">
                    {isRTL ? notification.title : notification.titleEn}
                  </h4>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDismiss(notification)}
                    className="text-muted-foreground hover:text-foreground h-6 w-6 p-0 ml-2"
                  >
                    <XIcon className="w-3 h-3" />
                  </Button>
                </div>
                
                <p className="text-sm text-muted-foreground mb-3 line-clamp-2">
                  {isRTL ? notification.message : notification.messageEn}
                </p>
                
                {notification.actionable && (
                  <Button
                    size="sm"
                    onClick={() => handleAction(notification)}
                    className="text-xs h-7 px-3"
                  >
                    {isRTL ? notification.actionLabel : notification.actionLabelEn}
                  </Button>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
