import { useAuthStore } from '../stores/authStore';
import { Button } from '@/components/ui/button';
import { GlobeIcon } from 'lucide-react';
import NotificationBell from './notifications/NotificationBell';
import TenantSwitcher from './TenantSwitcher';

// CP7: the user-facing theme/color-scheme picker (ThemeCustomizer) was
// removed by decision — only the single teal/green identity ships. The
// dormant theme-blue/purple/orange CSS blocks and the light/dark/system
// mechanism in themeStore.ts are left untouched (dark mode still applies
// automatically from the OS's prefers-color-scheme, with no in-app toggle).
export default function Topbar() {
  const { isRTL, toggleLanguage } = useAuthStore();

  return (
    <header className="h-20 border-b border-border bg-card/95 backdrop-blur-sm px-8 flex items-center justify-between sticky top-0 z-30 shadow-soft">
      {/* Left side content */}
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={toggleLanguage}
          className="bg-transparent text-foreground hover:bg-accent hover:text-accent-foreground rounded-xl transition-all duration-200"
        >
          <GlobeIcon className="w-4 h-4 me-2" />
          <span className="font-medium">{isRTL ? 'English' : 'العربية'}</span>
        </Button>
        <TenantSwitcher />
      </div>

      {/* Right side content */}
      <div className="flex items-center gap-3">
        <NotificationBell />
      </div>
    </header>
  );
}
