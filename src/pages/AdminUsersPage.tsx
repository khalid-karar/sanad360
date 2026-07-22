import { useAuthStore } from '../stores/authStore';
import AppShell from '../components/AppShell';
import { UsersIcon } from 'lucide-react';
import { EmptyState } from '@/components/ui/states';

// Deliberately a reskinned "not built yet" stub, not a real user-management
// screen — that's separately-scoped feature work (see KNOWN_LIMITATIONS.md
// backlog), not part of CP7's reskin pass.
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

        <EmptyState
          icon={<UsersIcon />}
          title={isRTL ? 'قريباً' : 'Coming Soon'}
          hint={isRTL
            ? 'إدارة المستخدمين ميزة قيد التطوير ولم تُبنَ بعد'
            : 'User management is under development and has not been built yet'}
        />
      </div>
    </AppShell>
  );
}
