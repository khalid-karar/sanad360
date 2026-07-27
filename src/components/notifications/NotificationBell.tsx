import { useEffect, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { useAuthStore } from '../../stores/authStore';
import { listNotifications, markAllRead } from '../../lib/api/notifications';
import type { NotificationRow } from '../../lib/database.types';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { BellIcon, XIcon, CheckIcon } from 'lucide-react';

/**
 * Real, DB-backed notification bell.
 * - Unread count comes from public.notifications (RLS: own rows only).
 * - Opening the panel and "Mark all read" persist is_read=true to the DB.
 */
export default function NotificationBell() {
  const { user, isRTL } = useAuthStore();
  const [items, setItems] = useState<NotificationRow[]>([]);
  const [isOpen, setIsOpen] = useState(false);

  const unread = items.filter((n) => !n.is_read).length;

  async function load() {
    if (!user?.id) return;
    try {
      setItems(await listNotifications(user.id));
    } catch {
      /* RLS / network — leave list empty */
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  async function handleMarkAll() {
    if (!user?.id) return;
    await markAllRead(user.id);
    setItems((prev) => prev.map((n) => ({ ...n, is_read: true })));
  }

  function fmt(ts: string): string {
    const diff = Date.now() - new Date(ts).getTime();
    const m = Math.floor(diff / 60000);
    const h = Math.floor(diff / 3600000);
    const d = Math.floor(diff / 86400000);
    if (m < 1) return isRTL ? 'الآن' : 'Now';
    if (m < 60) return isRTL ? `منذ ${m} دقيقة` : `${m}m ago`;
    if (h < 24) return isRTL ? `منذ ${h} ساعة` : `${h}h ago`;
    return isRTL ? `منذ ${d} يوم` : `${d}d ago`;
  }

  return (
    <Dialog.Root open={isOpen} onOpenChange={setIsOpen}>
      <Dialog.Trigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative text-foreground hover:text-foreground hover:bg-accent"
          aria-label={isRTL ? 'الإشعارات' : 'Notifications'}
        >
          <BellIcon className="w-5 h-5" />
          {unread > 0 && (
            <Badge
              variant="destructive"
              className="absolute -top-1 -end-1 h-5 w-5 flex items-center justify-center text-xs p-0 min-w-[20px]"
            >
              {unread > 99 ? '99+' : unread}
            </Badge>
          )}
        </Button>
      </Dialog.Trigger>

      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-gray-900/50 z-50" />
        <Dialog.Content
          dir={isRTL ? 'rtl' : 'ltr'}
          className="fixed z-50 inset-x-4 top-16 sm:inset-x-auto sm:end-4 sm:w-full sm:max-w-md max-h-[80vh] flex flex-col"
        >
          <Card className="bg-card text-card-foreground border-border max-h-[80vh] flex flex-col">
            <CardHeader className="pb-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <BellIcon className="w-6 h-6 text-primary" aria-hidden="true" />
                  <Dialog.Title className="text-xl font-semibold text-foreground">
                    {isRTL ? 'الإشعارات' : 'Notifications'}
                  </Dialog.Title>
                  {unread > 0 && (
                    <Badge variant="destructive" className="text-xs">{unread}</Badge>
                  )}
                </div>
                <Dialog.Close asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-muted-foreground hover:text-foreground"
                    aria-label={isRTL ? 'إغلاق' : 'Close'}
                  >
                    <XIcon className="w-5 h-5" />
                  </Button>
                </Dialog.Close>
              </div>
              {items.length > 0 && (
                <div className="flex gap-2 mt-4">
                  <Button variant="outline" size="sm" onClick={handleMarkAll} className="flex-1">
                    <CheckIcon className="w-4 h-4 me-2" />
                    {isRTL ? 'تحديد الكل كمقروء' : 'Mark All Read'}
                  </Button>
                </div>
              )}
            </CardHeader>
            <CardContent className="flex-1 overflow-hidden p-0">
              <ScrollArea className="h-full">
                <div className="p-6 pt-0 space-y-3">
                  {items.length === 0 ? (
                    <div className="text-center py-12">
                      <BellIcon className="w-16 h-16 text-muted-foreground mx-auto mb-4" aria-hidden="true" />
                      <p className="text-muted-foreground">
                        {isRTL ? 'لا توجد إشعارات' : 'No notifications'}
                      </p>
                    </div>
                  ) : (
                    items.map((n) => (
                      <Card
                        key={n.id}
                        className={`border-2 ${
                          !n.is_read ? 'bg-primary/5 border-primary/20' : 'bg-muted/30 border-border'
                        }`}
                      >
                        <CardContent className="p-4">
                          <div className="flex items-center justify-between mb-1">
                            <h4 className="font-medium text-foreground text-sm">
                              {isRTL ? n.title_ar : n.title_en}
                            </h4>
                            {!n.is_read && <div className="w-2 h-2 bg-primary rounded-full" />}
                          </div>
                          {(n.body_ar || n.body_en) && (
                            <p className="text-sm text-muted-foreground mb-2">
                              {isRTL ? n.body_ar : n.body_en}
                            </p>
                          )}
                          <span className="text-xs text-muted-foreground">{fmt(n.created_at)}</span>
                        </CardContent>
                      </Card>
                    ))
                  )}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
