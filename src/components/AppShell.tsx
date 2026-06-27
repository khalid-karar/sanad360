import { ReactNode } from 'react';
import { useAuthStore } from '../stores/authStore';
import Sidebar from './Sidebar';
import Topbar from './Topbar';

interface AppShellProps {
  children: ReactNode;
  role: 'driver' | 'company' | 'admin' | 'transport';
}

export default function AppShell({ children, role }: AppShellProps) {
  const { isRTL } = useAuthStore();

  return (
    <div className={`min-h-screen bg-background ${isRTL ? 'rtl' : 'ltr'}`}>
      <div className="flex">
        <Sidebar role={role} />
        <div className="flex-1 flex flex-col min-h-screen">
          <Topbar />
          <main className="flex-1 container-padding">
            <div className="max-w-7xl mx-auto animate-fade-in">
              {children}
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}
