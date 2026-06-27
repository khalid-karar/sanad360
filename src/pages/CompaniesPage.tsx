import { useAuthStore } from '../stores/authStore';
import AppShell from '../components/AppShell';
import CompaniesTable from '../components/admin/CompaniesTable';

export default function CompaniesPage() {
  const { isRTL } = useAuthStore();

  return (
    <AppShell role="admin">
      <div className={`space-y-8 ${isRTL ? 'rtl' : 'ltr'}`}>
        <div>
          <h1 className="text-3xl font-bold text-foreground mb-2">
            {isRTL ? 'المنشآت' : 'Companies'}
          </h1>
          <p className="text-muted-foreground">
            {isRTL ? 'جميع المنشآت المسجلة' : 'All registered companies'}
          </p>
        </div>

        <CompaniesTable />
      </div>
    </AppShell>
  );
}
