import { useAuthStore } from '../stores/authStore';
import AppShell from '../components/AppShell';
import AdminKPIs from '../components/admin/AdminKPIs';
import ComplianceMap from '../components/admin/ComplianceMap';
import CompaniesTable from '../components/admin/CompaniesTable';
import { EmptyState } from '@/components/ui/states';
import { ConstructionIcon } from 'lucide-react';

// Mirrors DB is_full_admin() (migration 025) and Sidebar.tsx's
// adminShellLinksByActualRole — system_admin/support_agent/billing_accountant
// share this shell's chrome but RLS doesn't grant them is_full_admin()'s
// bypass, so listAllCompanies() silently returns [] for them. Without this
// check they'd see a confusing "No companies" empty state that looks like a
// real, empty result rather than "this feature isn't available to your role".
const FULL_ADMIN_ROLES = ['admin', 'super_admin'];

const ROLE_LABEL: Record<string, { ar: string; en: string }> = {
  system_admin: { ar: 'مسؤول النظام', en: 'System Admin' },
  support_agent: { ar: 'موظف الدعم', en: 'Support Agent' },
  billing_accountant: { ar: 'محاسب الفوترة', en: 'Billing Accountant' },
};

export default function AdminDashboard() {
  const { isRTL, user } = useAuthStore();
  const isFullAdmin = FULL_ADMIN_ROLES.includes(user?.role ?? '');
  const roleLabel = user?.role ? ROLE_LABEL[user.role] : undefined;

  return (
    <AppShell role="admin">
      <div className={`space-y-8 ${isRTL ? 'rtl' : 'ltr'}`}>
        <div>
          <h1 className="text-3xl font-bold text-foreground mb-2">
            {isRTL ? 'لوحة تحكم المسؤول' : 'Admin Dashboard'}
          </h1>
          <p className="text-muted-foreground">
            {isRTL ? 'نظرة عامة على الامتثال الوطني' : 'National Compliance Overview'}
          </p>
        </div>

        {isFullAdmin ? (
          <>
            <AdminKPIs />
            <ComplianceMap />
            <CompaniesTable />
          </>
        ) : (
          <EmptyState
            icon={<ConstructionIcon />}
            title={isRTL ? 'قريباً' : 'Coming Soon'}
            hint={isRTL
              ? `ميزات ${roleLabel?.ar ?? 'هذا الدور'} قيد التطوير ولم تُبنَ بعد`
              : `${roleLabel?.en ?? 'This role’s'} features are under development and have not been built yet`}
          />
        )}
      </div>
    </AppShell>
  );
}
