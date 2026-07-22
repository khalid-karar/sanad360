import { useAuthStore } from '../stores/authStore';
import AppShell from '../components/AppShell';
import { BarChart3Icon } from 'lucide-react';
import { EmptyState } from '@/components/ui/states';

export default function AdminAnalyticsPage() {
  const { isRTL } = useAuthStore();

  return (
    <AppShell role="admin">
      <div className={`space-y-8 ${isRTL ? 'rtl' : 'ltr'}`}>
        <div>
          <h1 className="text-3xl font-bold text-foreground mb-2">
            {isRTL ? 'التحليلات' : 'Analytics'}
          </h1>
          <p className="text-muted-foreground">
            {isRTL ? 'تحليلات الامتثال على مستوى المنصة' : 'Platform-wide compliance analytics'}
          </p>
        </div>

        <EmptyState
          icon={<BarChart3Icon />}
          title={isRTL ? 'قريباً' : 'Coming Soon'}
          hint={isRTL
            ? 'هذه الميزة قيد التطوير وستتوفر في إصدار قادم'
            : 'This feature is under development and will be available in a future release'}
        />
      </div>
    </AppShell>
  );
}
