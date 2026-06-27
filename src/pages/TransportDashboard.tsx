import { useEffect } from 'react';
import { useAuthStore } from '../stores/authStore';
import { useTransportStore } from '../stores/transportStore';
import AppShell from '../components/AppShell';
import TransportKPIs from '../components/transport/TransportKPIs';
import RealAlertsPanel from '../components/transport/RealAlertsPanel';

export default function TransportDashboard() {
  const { isRTL, user } = useAuthStore();
  const { pendingTasks, complianceRate, todayPickups, loadDrivers, loadVehicles } = useTransportStore();

  useEffect(() => {
    loadDrivers(user?.transport_company_id ?? undefined);
    loadVehicles(user?.transport_company_id ?? undefined);
  }, [loadDrivers, loadVehicles, user?.transport_company_id]);

  return (
    <AppShell role="transport">
      <div className={`space-y-8 ${isRTL ? 'rtl' : 'ltr'}`}>
        <div>
          <h1 className="text-3xl font-bold text-foreground mb-2">
            {isRTL ? `مرحباً بكم في ${user?.name}` : `Welcome to ${user?.name}`}
          </h1>
          <p className="text-muted-foreground">
            {isRTL ? 'لوحة تحكم شركة النقل' : 'Transport Company Dashboard'}
          </p>
        </div>

        <TransportKPIs 
          pendingTasks={pendingTasks}
          complianceRate={complianceRate}
          todayPickups={todayPickups}
        />

        <RealAlertsPanel companyId={user?.company_id ?? null} />
      </div>
    </AppShell>
  );
}
