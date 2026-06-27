import { useAuthStore } from '../stores/authStore';
import AppShell from '../components/AppShell';
import AdminKPIs from '../components/admin/AdminKPIs';
import ComplianceMap from '../components/admin/ComplianceMap';
import CompaniesTable from '../components/admin/CompaniesTable';

export default function AdminDashboard() {
  const { isRTL } = useAuthStore();

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

        <AdminKPIs />

        <ComplianceMap />

        <CompaniesTable />
      </div>
    </AppShell>
  );
}
