import { ReactNode } from 'react';
import { useAuthStore } from '../stores/authStore';
import Sidebar from './Sidebar';
import Topbar from './Topbar';
import DriverBottomNav from './driver/DriverBottomNav';

interface AppShellProps {
  children: ReactNode;
  role: 'driver' | 'company' | 'admin' | 'transport' | 'recycler' | 'reviewer'
    | 'branch' | 'consultant' | 'gov' | 'applicant';
}

export default function AppShell({ children, role }: AppShellProps) {
  const { isRTL } = useAuthStore();
  const isDriver = role === 'driver';

  return (
    <div className={`min-h-screen bg-background ${isRTL ? 'rtl' : 'ltr'}`}>
      <div className="flex">
        <Sidebar role={role} />
        <div className="flex-1 flex flex-col min-h-screen">
          <Topbar />
          <main className={`flex-1 container-padding ${isDriver ? 'pb-24 lg:pb-0' : ''}`}>
            <div className="max-w-7xl mx-auto animate-fade-in">
              {children}
            </div>
          </main>
        </div>
      </div>
      {isDriver && <DriverBottomNav />}
    </div>
  );
}
