import { useState } from 'react';
import { useAuthStore } from '../../stores/authStore';
import { useNotificationStore, Notification } from '../../stores/notificationStore';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { 
  BellIcon, 
  XIcon, 
  CheckIcon, 
  AlertTriangleIcon, 
  InfoIcon, 
  CheckCircle2Icon,
  XCircleIcon,
  VolumeXIcon,
  Volume2Icon
} from 'lucide-react';

interface NotificationCenterProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function NotificationCenter({ isOpen, onClose }: NotificationCenterProps) {
  const { isRTL, user } = useAuthStore();
  const {
    unreadCount,
    soundEnabled,
    markAsRead, 
    markAllAsRead, 
    removeNotification, 
    clearAll,
    toggleSound,
    getNotificationsByRole 
  } = useNotificationStore();

  const [filter, setFilter] = useState<'all' | 'unread' | 'critical'>('all');

  if (!isOpen) return null;

  const roleNotifications = getNotificationsByRole(user?.role || '');
  
  const filteredNotifications = roleNotifications.filter(notification => {
    switch (filter) {
      case 'unread':
        return !notification.read;
      case 'critical':
        return notification.priority === 'critical' || notification.priority === 'high';
      default:
        return true;
    }
  });

  const getNotificationIcon = (notification: Notification) => {
    switch (notification.type) {
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

  const getPriorityBadge = (priority: Notification['priority']) => {
    const config = {
      low: { variant: 'secondary' as const, label: isRTL ? 'منخفض' : 'Low' },
      medium: { variant: 'default' as const, label: isRTL ? 'متوسط' : 'Medium' },
      high: { variant: 'destructive' as const, label: isRTL ? 'عالي' : 'High' },
      critical: { variant: 'destructive' as const, label: isRTL ? 'حرج' : 'Critical' },
    };

    const { variant, label } = config[priority];
    return <Badge variant={variant} className="text-xs">{label}</Badge>;
  };

  const formatTimestamp = (timestamp: Date) => {
    const now = new Date();
    const diff = now.getTime() - timestamp.getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return isRTL ? 'الآن' : 'Now';
    if (minutes < 60) return isRTL ? `منذ ${minutes} دقيقة` : `${minutes}m ago`;
    if (hours < 24) return isRTL ? `منذ ${hours} ساعة` : `${hours}h ago`;
    return isRTL ? `منذ ${days} يوم` : `${days}d ago`;
  };

  const handleNotificationAction = (notification: Notification) => {
    if (notification.onAction) {
      notification.onAction();
    }
    markAsRead(notification.id);
  };

  return (
    <div
      className="fixed inset-0 bg-gray-900/50 z-[1200] flex items-end sm:items-start justify-center sm:justify-end sm:p-4"
      onClick={onClose}
    >
      <Card
        className="w-full sm:max-w-md bg-card text-card-foreground border-border max-h-[75vh] sm:max-h-[85vh] flex flex-col rounded-b-none sm:rounded-2xl sm:mt-16 pb-safe"
        onClick={(e) => e.stopPropagation()}
      >
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <BellIcon className="w-6 h-6 text-primary" />
          <CardTitle className="text-xl text-foreground">
            {isRTL ? 'الإشعارات' : 'Notifications'}
          </CardTitle>
          {unreadCount > 0 && (
            <Badge variant="destructive" className="text-xs">
              {unreadCount}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleSound}
            className="text-muted-foreground hover:text-foreground"
          >
            {soundEnabled ? (
              <Volume2Icon className="w-4 h-4" />
            ) : (
              <VolumeXIcon className="w-4 h-4" />
            )}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground"
          >
            <XIcon className="w-5 h-5" />
          </Button>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex gap-2 mt-4">
        <Button
          variant={filter === 'all' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setFilter('all')}
          className="flex-1"
        >
          {isRTL ? 'الكل' : 'All'}
        </Button>
        <Button
          variant={filter === 'unread' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setFilter('unread')}
          className="flex-1"
        >
          {isRTL ? 'غير مقروءة' : 'Unread'}
        </Button>
        <Button
          variant={filter === 'critical' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setFilter('critical')}
          className="flex-1"
        >
          {isRTL ? 'مهمة' : 'Important'}
        </Button>
      </div>

      {/* Action Buttons */}
      {filteredNotifications.length > 0 && (
        <div className="flex gap-2 mt-4">
          <Button
            variant="outline"
            size="sm"
            onClick={markAllAsRead}
            className="flex-1"
          >
            <CheckIcon className="w-4 h-4 mr-2" />
            {isRTL ? 'تحديد الكل كمقروء' : 'Mark All Read'}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={clearAll}
            className="flex-1 text-destructive hover:text-destructive"
          >
            <XIcon className="w-4 h-4 mr-2" />
            {isRTL ? 'مسح الكل' : 'Clear All'}
          </Button>
        </div>
      )}
    </CardHeader>

    <CardContent className="flex-1 overflow-hidden p-0">
      <ScrollArea className="h-full">
        <div className="p-6 pt-0">
          {filteredNotifications.length === 0 ? (
            <div className="text-center py-12">
              <BellIcon className="w-16 h-16 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-medium text-foreground mb-2">
                {isRTL ? 'لا توجد إشعارات' : 'No Notifications'}
              </h3>
              <p className="text-muted-foreground">
                {isRTL ? 'ستظهر الإشعارات الجديدة هنا' : 'New notifications will appear here'}
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {filteredNotifications.map((notification, index) => (
                <div key={notification.id}>
                  <Card
                        className={`border-2 cursor-pointer transition-all hover:shadow-md ${
                          !notification.read 
                            ? 'bg-primary/5 border-primary/20' 
                            : 'bg-muted/30 border-border'
                        }`}
                        onClick={() => !notification.read && markAsRead(notification.id)}
                      >
                    <CardContent className="p-4">
                      <div className="flex items-start gap-3">
                        {getNotificationIcon(notification)}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between mb-2">
                            <h4 className="font-medium text-foreground text-sm truncate">
                              {isRTL ? notification.title : notification.titleEn}
                            </h4>
                            <div className="flex items-center gap-2 ml-2">
                              {getPriorityBadge(notification.priority)}
                              {!notification.read && (
                                <div className="w-2 h-2 bg-primary rounded-full" />
                              )}
                            </div>
                          </div>
                          
                          <p className="text-sm text-muted-foreground mb-3 line-clamp-2">
                            {isRTL ? notification.message : notification.messageEn}
                          </p>
                          
                          <div className="flex items-center justify-between">
                            <span className="text-xs text-muted-foreground">
                              {formatTimestamp(notification.timestamp)}
                            </span>
                            
                            <div className="flex items-center gap-2">
                              {notification.actionable && (
                                <Button
                                  size="sm"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleNotificationAction(notification);
                                  }}
                                  className="text-xs h-7 px-3"
                                >
                                  {isRTL ? notification.actionLabel : notification.actionLabelEn}
                                </Button>
                              )}
                              
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  removeNotification(notification.id);
                                }}
                                className="text-muted-foreground hover:text-foreground h-7 w-7 p-0"
                              >
                                <XIcon className="w-3 h-3" />
                              </Button>
                            </div>
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                      
                      {index < filteredNotifications.length - 1 && (
                        <Separator className="my-4 bg-border" />
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}
