import { useAuthStore } from '../stores/authStore';
import AppShell from '../components/AppShell';
import { BarChart3Icon } from 'lucide-react';

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

        <div className="flex flex-col items-center justify-center py-24 text-center text-muted-foreground">
          <BarChart3Icon className="w-12 h-12 mb-4 opacity-40" />
          <p className="text-lg font-medium">{isRTL ? 'قريباً' : 'Coming Soon'}</p>
        </div>
      </div>
    </AppShell>
  );
}
