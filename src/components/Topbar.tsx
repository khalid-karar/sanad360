import { useState } from 'react';
import { useAuthStore } from '../stores/authStore';
import { Button } from '@/components/ui/button';
import { GlobeIcon, PaletteIcon } from 'lucide-react';
import NotificationBell from './notifications/NotificationBell';
import ThemeCustomizer from './theme/ThemeCustomizer';
import TenantSwitcher from './TenantSwitcher';

export default function Topbar() {
  const { isRTL, toggleLanguage } = useAuthStore();
  const [showThemeCustomizer, setShowThemeCustomizer] = useState(false);

  return (
    <>
      <header className="h-20 border-b border-border bg-card/95 backdrop-blur-sm px-8 flex items-center justify-between sticky top-0 z-30 shadow-soft">
        {/* Left side content */}
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={toggleLanguage}
            className="bg-transparent text-foreground hover:bg-accent hover:text-accent-foreground rounded-xl transition-all duration-200"
          >
            <GlobeIcon className="w-4 h-4 mr-2" />
            <span className="font-medium">{isRTL ? 'English' : 'العربية'}</span>
          </Button>
          <TenantSwitcher />
        </div>

        {/* Right side content */}
        <div className="flex items-center gap-3">
          <NotificationBell />
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setShowThemeCustomizer(true)}
            className="bg-transparent text-foreground hover:bg-accent hover:text-accent-foreground transition-all duration-200"
            title={isRTL ? 'تخصيص المظهر' : 'Customize Theme'}
          >
            <PaletteIcon className="w-4 h-4" />
          </Button>
        </div>
      </header>

      <ThemeCustomizer 
        isOpen={showThemeCustomizer} 
        onClose={() => setShowThemeCustomizer(false)} 
      />
    </>
  );
}
