import { create } from 'zustand';

export type NotificationType = 'success' | 'warning' | 'error' | 'info';
export type NotificationPriority = 'low' | 'medium' | 'high' | 'critical';

export interface Notification {
  id: string;
  type: NotificationType;
  priority: NotificationPriority;
  title: string;
  titleEn: string;
  message: string;
  messageEn: string;
  timestamp: Date;
  read: boolean;
  actionable?: boolean;
  actionLabel?: string;
  actionLabelEn?: string;
  onAction?: () => void;
  autoHide?: boolean;
  duration?: number;
  userId?: string;
  role?: string;
}

interface NotificationState {
  notifications: Notification[];
  unreadCount: number;
  soundEnabled: boolean;
  pushEnabled: boolean;
  addNotification: (notification: Omit<Notification, 'id' | 'timestamp' | 'read'>) => void;
  markAsRead: (id: string) => void;
  markAllAsRead: () => void;
  removeNotification: (id: string) => void;
  clearAll: () => void;
  toggleSound: () => void;
  togglePush: () => void;
  getNotificationsByRole: (role: string) => Notification[];
  getUnreadByPriority: (priority: NotificationPriority) => Notification[];
}

// Mock notifications for different roles
const mockNotifications: Notification[] = [
  {
    id: '1',
    type: 'warning',
    priority: 'high',
    title: 'رخصة السائق تنتهي قريباً',
    titleEn: 'Driver License Expiring Soon',
    message: 'رخصة السائق أحمد محمد تنتهي خلال 15 يوماً',
    messageEn: "Driver Ahmed Mohammed's license expires in 15 days",
    timestamp: new Date(Date.now() - 300000), // 5 minutes ago
    read: false,
    actionable: true,
    actionLabel: 'تجديد الرخصة',
    actionLabelEn: 'Renew License',
    role: 'transport',
  },
  {
    id: '2',
    type: 'success',
    priority: 'medium',
    title: 'تم إرسال البيان بنجاح',
    titleEn: 'Manifest Submitted Successfully',
    message: 'تم إرسال بيان الامتثال لشركة النخيل إلى NCWM',
    messageEn: 'Compliance manifest for Al-Nakheel Company submitted to NCWM',
    timestamp: new Date(Date.now() - 600000), // 10 minutes ago
    read: false,
    role: 'company',
  },
  {
    id: '3',
    type: 'error',
    priority: 'critical',
    title: 'فشل في التحقق من الموقع',
    titleEn: 'Location Verification Failed',
    message: 'لا يمكن التحقق من موقع الالتقاط الحالي',
    messageEn: 'Unable to verify current pickup location',
    timestamp: new Date(Date.now() - 120000), // 2 minutes ago
    read: false,
    actionable: true,
    actionLabel: 'إعادة المحاولة',
    actionLabelEn: 'Retry',
    role: 'driver',
  },
  {
    id: '4',
    type: 'info',
    priority: 'low',
    title: 'تحديث النظام متاح',
    titleEn: 'System Update Available',
    message: 'يتوفر تحديث جديد للنظام مع تحسينات في الأداء',
    messageEn: 'New system update available with performance improvements',
    timestamp: new Date(Date.now() - 1800000), // 30 minutes ago
    read: true,
    role: 'admin',
  },
  {
    id: '5',
    type: 'warning',
    priority: 'high',
    title: 'تنبيه امتثال',
    titleEn: 'Compliance Alert',
    message: 'مستشفى الأمل يحتاج إلى مراجعة فورية للامتثال',
    messageEn: 'Al-Amal Hospital requires immediate compliance review',
    timestamp: new Date(Date.now() - 900000), // 15 minutes ago
    read: false,
    actionable: true,
    actionLabel: 'مراجعة الآن',
    actionLabelEn: 'Review Now',
    role: 'admin',
  },
];

export const useNotificationStore = create<NotificationState>((set, get) => ({
  notifications: mockNotifications,
  unreadCount: mockNotifications.filter(n => !n.read).length,
  soundEnabled: true,
  pushEnabled: true,

  addNotification: (notification) => {
    const newNotification: Notification = {
      ...notification,
      id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
      timestamp: new Date(),
      read: false,
    };

    set((state) => ({
      notifications: [newNotification, ...state.notifications],
      unreadCount: state.unreadCount + 1,
    }));

    // Play sound if enabled
    if (get().soundEnabled && notification.priority !== 'low') {
      const audio = new Audio('/notification-sound.mp3');
      audio.volume = notification.priority === 'critical' ? 0.8 : 0.5;
      audio.play().catch(() => {
        // Fallback for browsers that don't allow autoplay
        console.log('Notification sound blocked by browser');
      });
    }

    // Auto-hide notification if specified
    if (notification.autoHide !== false) {
      const duration = notification.duration || (notification.priority === 'critical' ? 10000 : 5000);
      setTimeout(() => {
        get().removeNotification(newNotification.id);
      }, duration);
    }
  },

  markAsRead: (id) => {
    set((state) => ({
      notifications: state.notifications.map((n) =>
        n.id === id ? { ...n, read: true } : n
      ),
      unreadCount: Math.max(0, state.unreadCount - 1),
    }));
  },

  markAllAsRead: () => {
    set((state) => ({
      notifications: state.notifications.map((n) => ({ ...n, read: true })),
      unreadCount: 0,
    }));
  },

  removeNotification: (id) => {
    set((state) => {
      const notification = state.notifications.find(n => n.id === id);
      const wasUnread = notification && !notification.read;
      
      return {
        notifications: state.notifications.filter((n) => n.id !== id),
        unreadCount: wasUnread ? Math.max(0, state.unreadCount - 1) : state.unreadCount,
      };
    });
  },

  clearAll: () => {
    set({
      notifications: [],
      unreadCount: 0,
    });
  },

  toggleSound: () => {
    set((state) => ({
      soundEnabled: !state.soundEnabled,
    }));
  },

  togglePush: () => {
    set((state) => ({
      pushEnabled: !state.pushEnabled,
    }));
  },

  getNotificationsByRole: (role) => {
    return get().notifications.filter(n => !n.role || n.role === role);
  },

  getUnreadByPriority: (priority) => {
    return get().notifications.filter(n => !n.read && n.priority === priority);
  },
}));
