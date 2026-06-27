import { useEffect } from 'react';
import { useAuthStore } from '../stores/authStore';
import { useTransportStore } from '../stores/transportStore';
import AppShell from '../components/AppShell';
import TransportKPIs from '../components/transport/TransportKPIs';
import AlertsList from '../components/transport/AlertsList';

export default function TransportDashboard() {
  const { isRTL, user } = useAuthStore();
  const { alerts, pendingTasks, complianceRate, todayPickups, loadDrivers, loadVehicles } = useTransportStore();

  useEffect(() => {
    loadDrivers();
    loadVehicles();
  }, [loadDrivers, loadVehicles]);

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

        <AlertsList alerts={alerts} />
      </div>
    </AppShell>
  );
}
