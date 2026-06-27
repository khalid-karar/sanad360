import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { TruckIcon, LayoutDashboardIcon, ClipboardListIcon, SettingsIcon, LogOutIcon, MenuIcon, XIcon, Building2Icon, BarChart3Icon, UsersIcon, ShieldIcon, MapPinIcon, PackageIcon, AlertTriangleIcon } from 'lucide-react';
import Logo from './Logo';

interface SidebarProps {
  role: 'driver' | 'company' | 'admin' | 'transport';
}

export default function Sidebar({ role }: SidebarProps) {
  const navigate = useNavigate();
  const { user, logout, isRTL } = useAuthStore();
  const [isOpen, setIsOpen] = useState(false);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const driverLinks = [
    { icon: LayoutDashboardIcon, label: isRTL ? 'الرئيسية' : 'Dashboard', path: '/driver' },
    { icon: ClipboardListIcon, label: isRTL ? 'جدول اليوم' : "Today's Schedule", path: '/driver' },
    { icon: MapPinIcon, label: isRTL ? 'المواقع' : 'Locations', path: '/driver' },
  ];

  const companyLinks = [
    { icon: LayoutDashboardIcon, label: isRTL ? 'الرئيسية' : 'Dashboard', path: '/company' },
    { icon: BarChart3Icon, label: isRTL ? 'التقارير' : 'Reports', path: '/company' },
    { icon: ClipboardListIcon, label: isRTL ? 'السجلات' : 'Records', path: '/company' },
  ];

  const adminLinks = [
    { icon: LayoutDashboardIcon, label: isRTL ? 'الرئيسية' : 'Dashboard', path: '/admin' },
    { icon: Building2Icon, label: isRTL ? 'المنشآت' : 'Companies', path: '/admin' },
    { icon: UsersIcon, label: isRTL ? 'المستخدمون' : 'Users', path: '/admin' },
    { icon: BarChart3Icon, label: isRTL ? 'التحليلات' : 'Analytics', path: '/admin' },
  ];

  const transportLinks = [
    { icon: LayoutDashboardIcon, label: isRTL ? 'الرئيسية' : 'Dashboard', path: '/transport' },
    { icon: AlertTriangleIcon, label: isRTL ? 'التنبيهات' : 'Alerts', path: '/transport' },
    { icon: UsersIcon, label: isRTL ? 'إدارة السائقين' : 'Driver Management', path: '/transport/drivers' },
    { icon: TruckIcon, label: isRTL ? 'إدارة المركبات' : 'Vehicle Management', path: '/transport/vehicles' },
    { icon: ClipboardListIcon, label: isRTL ? 'سجل الالتقاطات' : 'Pickup Log', path: '/transport/pickups' },
  ];

  const links = role === 'driver' ? driverLinks : role === 'company' ? companyLinks : role === 'transport' ? transportLinks : adminLinks;

  const sidebarContent = (
    <div className="flex flex-col h-full bg-card border-l border-border shadow-soft">
      <div className="p-8 border-b border-border">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 bg-gradient-primary rounded-2xl flex items-center justify-center shadow-medium p-1">
            <Logo className="w-full h-full" />
          </div>
          <div>
            <h2 className="font-bold text-foreground text-lg">
              {isRTL ? 'تدوير 360' : 'Tadweer360'}
            </h2>
            <p className="text-sm text-muted-foreground">
              {role === 'driver' && (isRTL ? 'سائق' : 'Driver')}
              {role === 'company' && (isRTL ? 'منشأة' : 'Company')}
              {role === 'transport' && (isRTL ? 'شركة نقل' : 'Transport')}
              {role === 'admin' && (isRTL ? 'مسؤول' : 'Admin')}
            </p>
          </div>
        </div>
      </div>

      <ScrollArea className="flex-1 p-6">
        <nav className="space-y-2">
          {links.map((link) => (
            <Button
              key={link.path}
              variant="ghost"
              size="default"
              className="w-full justify-start bg-transparent text-foreground hover:bg-accent hover:text-accent-foreground rounded-xl h-12 transition-all duration-200"
              onClick={() => {
                navigate(link.path);
                setIsOpen(false);
              }}
            >
              <link.icon className="w-5 h-5 ml-3" />
              <span className="font-medium">{link.label}</span>
            </Button>
          ))}
        </nav>

        <Separator className="my-6 bg-border" />

        <nav className="space-y-2">
          <Button
            variant="ghost"
            size="default"
            className="w-full justify-start bg-transparent text-foreground hover:bg-accent hover:text-accent-foreground rounded-xl h-12 transition-all duration-200"
          >
            <SettingsIcon className="w-5 h-5 ml-3" />
            <span className="font-medium">{isRTL ? 'الإعدادات' : 'Settings'}</span>
          </Button>
        </nav>
      </ScrollArea>

      <div className="p-6 border-t border-border">
        <div className="mb-6 p-4 bg-muted/50 rounded-2xl">
          <p className="font-semibold text-sm text-foreground">{user?.name}</p>
          <p className="text-xs text-muted-foreground mt-1">{user?.email || user?.phone}</p>
        </div>
        <Button
          variant="outline"
          size="default"
          className="w-full bg-background text-foreground border-border hover:bg-destructive hover:text-destructive-foreground hover:border-destructive transition-all duration-200"
          onClick={handleLogout}
        >
          <LogOutIcon className="w-4 h-4 ml-2" />
          <span className="font-medium">{isRTL ? 'تسجيل الخروج' : 'Logout'}</span>
        </Button>
      </div>
    </div>
  );

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        className="lg:hidden fixed top-4 right-4 z-50 bg-card text-foreground hover:bg-accent hover:text-accent-foreground"
        onClick={() => setIsOpen(!isOpen)}
      >
        {isOpen ? <XIcon className="w-6 h-6" /> : <MenuIcon className="w-6 h-6" />}
      </Button>

      <aside className="hidden lg:block w-64 h-screen sticky top-0">{sidebarContent}</aside>

      {isOpen && (
        <>
          <div
            className="lg:hidden fixed inset-0 bg-gray-900/50 z-40"
            onClick={() => setIsOpen(false)}
          />
          <aside className="lg:hidden fixed top-0 right-0 w-64 h-screen z-50">{sidebarContent}</aside>
        </>
      )}
    </>
  );
}
