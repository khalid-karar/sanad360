import { useLocation, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../stores/authStore';
import { ClipboardListIcon, CalendarClockIcon, FactoryIcon } from 'lucide-react';

const TABS = [
  { path: '/driver',            icon: ClipboardListIcon, ar: 'المهام',       en: 'Tasks' },
  { path: '/driver/schedule',   icon: CalendarClockIcon, ar: 'جدولي',        en: 'Schedule' },
  { path: '/driver/deliveries', icon: FactoryIcon,       ar: 'التسليم',      en: 'Deliveries' },
];

/**
 * Field-first navigation: the driver's three destinations live in the thumb
 * zone as 56px+ targets instead of a top-corner hamburger. Mobile only —
 * desktop keeps the sidebar.
 */
export default function DriverBottomNav() {
  const { isRTL } = useAuthStore();
  const navigate = useNavigate();
  const { pathname } = useLocation();

  return (
    <nav
      className="lg:hidden fixed bottom-0 inset-x-0 z-40 bg-card border-t border-border pb-safe"
      aria-label={isRTL ? 'تنقل السائق' : 'Driver navigation'}
    >
      <div className="grid grid-cols-3">
        {TABS.map((tab) => {
          const active = pathname === tab.path;
          return (
            <button
              key={tab.path}
              onClick={() => navigate(tab.path)}
              aria-current={active ? 'page' : undefined}
              className={`flex flex-col items-center justify-center gap-1 h-16 text-xs font-medium ${
                active ? 'text-primary' : 'text-muted-foreground'
              }`}
            >
              <tab.icon className={`w-6 h-6 ${active ? 'stroke-[2.25]' : ''}`} aria-hidden />
              {isRTL ? tab.ar : tab.en}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
