import { useAuthStore } from '../stores/authStore';
import AppShell from '../components/AppShell';
import { UsersIcon } from 'lucide-react';

export default function AdminUsersPage() {
  const { isRTL } = useAuthStore();

  return (
    <AppShell role="admin">
      <div className={`space-y-8 ${isRTL ? 'rtl' : 'ltr'}`}>
        <div>
          <h1 className="text-3xl font-bold text-foreground mb-2">
            {isRTL ? 'المستخدمون' : 'Users'}
          </h1>
          <p className="text-muted-foreground">
            {isRTL ? 'إدارة مستخدمي المنصة' : 'Manage platform users'}
          </p>
        </div>

        <div className="flex flex-col items-center justify-center py-24 text-center text-muted-foreground">
          <UsersIcon className="w-12 h-12 mb-4 opacity-40" />
          <p className="text-lg font-medium">{isRTL ? 'قريباً' : 'Coming Soon'}</p>
        </div>
      </div>
    </AppShell>
  );
}
