import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { TruckIcon, LayoutDashboardIcon, ClipboardListIcon, SettingsIcon, LogOutIcon, MenuIcon, XIcon, Building2Icon, BarChart3Icon, UsersIcon, MapPinIcon, AlertTriangleIcon, CalendarClockIcon, FactoryIcon, ScaleIcon, FileCheckIcon, ClipboardCheckIcon } from 'lucide-react';
// TruckIcon reused for the company "Approved Transporters" link.
import Logo from './Logo';

interface SidebarProps {
  role: 'driver' | 'company' | 'admin' | 'transport' | 'recycler' | 'reviewer'
    | 'branch' | 'consultant' | 'gov';
}

export default function Sidebar({ role }: SidebarProps) {
  const navigate = useNavigate();
  const { user, logout, isRTL } = useAuthStore();
  const [isOpen, setIsOpen] = useState(false);

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const driverLinks = [
    { icon: LayoutDashboardIcon, label: isRTL ? 'الرئيسية' : 'Dashboard', path: '/driver' },
    { icon: CalendarClockIcon, label: isRTL ? 'جدولي' : 'My Schedule', path: '/driver/schedule' },
    { icon: MapPinIcon, label: isRTL ? 'تأكيد التسليم' : 'Deliveries', path: '/driver/deliveries' },
    { icon: FileCheckIcon, label: isRTL ? 'مستنداتي' : 'My Documents', path: '/driver/onboarding' },
  ];

  const companyLinks = [
    { icon: LayoutDashboardIcon, label: isRTL ? 'الرئيسية' : 'Dashboard', path: '/company' },
    { icon: Building2Icon, label: isRTL ? 'الفروع' : 'Branches', path: '/company/branches' },
    { icon: TruckIcon, label: isRTL ? 'الناقلون المعتمدون' : 'Approved Transporters', path: '/company/transporters' },
    { icon: CalendarClockIcon, label: isRTL ? 'طلب التقاط' : 'Request Pickup', path: '/company/schedule' },
    { icon: AlertTriangleIcon, label: isRTL ? 'قائمة المراجعة' : 'Review Queue', path: '/company/review' },
    { icon: ClipboardListIcon, label: isRTL ? 'سجل الالتقاطات' : 'Pickup Log', path: '/company/pickups' },
    { icon: FileCheckIcon, label: isRTL ? 'المستندات والتأسيس' : 'Onboarding & Documents', path: '/company/onboarding' },
  ];

  // The admin SHELL is shared by all 5 Maya-side roles (admin, super_admin,
  // system_admin, support_agent, billing_accountant) — but each gets its OWN
  // nav array below. There is deliberately no shared "adminLinks" fallback:
  // that was the exact bug this phase fixes (a silent `: adminLinks` default
  // would hand every new Maya-side role the full admin nav regardless of
  // what it can actually see under RLS).
  const fullAdminLinks = [
    { icon: LayoutDashboardIcon, label: isRTL ? 'الرئيسية' : 'Dashboard', path: '/admin' },
    { icon: Building2Icon, label: isRTL ? 'المنشآت' : 'Companies', path: '/admin/companies' },
    { icon: UsersIcon, label: isRTL ? 'المستخدمون' : 'Users', path: '/admin/users' },
    { icon: BarChart3Icon, label: isRTL ? 'التحليلات' : 'Analytics', path: '/admin/analytics' },
    { icon: ClipboardCheckIcon, label: isRTL ? 'مراجعة المستندات' : 'Document Review', path: '/admin/document-review' },
  ];

  // system_admin/support_agent/billing_accountant: RLS doesn't grant any of
  // them is_full_admin()'s bypass (migration 025), and support_agent's
  // audited-RPC-only surface / billing_accountant's billing UI don't exist
  // yet (migration 024/025 headers — both explicitly greenfield/pending).
  // Dashboard-only is the honest nav for what's actually wired today; it is
  // NOT a stand-in for the full admin nav.
  const dashboardOnlyLinks = [
    { icon: LayoutDashboardIcon, label: isRTL ? 'الرئيسية' : 'Dashboard', path: '/admin' },
  ];

  const adminShellLinksByActualRole: Record<string, typeof fullAdminLinks> = {
    admin: fullAdminLinks,
    super_admin: fullAdminLinks,
    system_admin: dashboardOnlyLinks,
    support_agent: dashboardOnlyLinks,
    billing_accountant: dashboardOnlyLinks,
  };

  const adminShellLabel: Record<string, string> = {
    admin: isRTL ? 'مسؤول' : 'Admin',
    super_admin: isRTL ? 'مسؤول عام' : 'Super Admin',
    system_admin: isRTL ? 'مسؤول النظام' : 'System Admin',
    support_agent: isRTL ? 'موظف الدعم' : 'Support Agent',
    billing_accountant: isRTL ? 'محاسب الفوترة' : 'Billing Accountant',
  };

  const transportLinks = [
    // "Alerts" used to be a separate nav item pointing at the same '/transport'
    // URL as Dashboard — RealAlertsPanel is embedded IN the dashboard, so it
    // was never a distinct page; clicking it just looked like a dead click.
    { icon: LayoutDashboardIcon, label: isRTL ? 'الرئيسية' : 'Dashboard', path: '/transport' },
    { icon: UsersIcon, label: isRTL ? 'إدارة السائقين' : 'Driver Management', path: '/transport/drivers' },
    { icon: TruckIcon, label: isRTL ? 'إدارة المركبات' : 'Vehicle Management', path: '/transport/vehicles' },
    { icon: ClipboardListIcon, label: isRTL ? 'سجل الالتقاطات' : 'Pickup Log', path: '/transport/pickups' },
    { icon: FactoryIcon, label: isRTL ? 'الرحلات' : 'Trips', path: '/transport/trips' },
    { icon: FileCheckIcon, label: isRTL ? 'المستندات والتأسيس' : 'Onboarding & Documents', path: '/transport/onboarding' },
  ];

  const recyclerLinks = [
    { icon: ScaleIcon, label: isRTL ? 'الرئيسية' : 'Dashboard', path: '/recycler' },
    { icon: FileCheckIcon, label: isRTL ? 'المستندات والتأسيس' : 'Onboarding & Documents', path: '/recycler/onboarding' },
  ];

  const reviewerLinks = [
    { icon: ClipboardCheckIcon, label: isRTL ? 'قائمة مراجعة المستندات' : 'Document Review Queue', path: '/reviewer' },
  ];

  const branchLinks = [
    { icon: LayoutDashboardIcon, label: isRTL ? 'الرئيسية' : 'Dashboard', path: '/branch' },
  ];

  const consultantLinks = [
    { icon: LayoutDashboardIcon, label: isRTL ? 'محفظة العملاء' : 'Client Portfolio', path: '/consultant' },
  ];

  const govLinks = [
    { icon: BarChart3Icon, label: isRTL ? 'الإحصاءات الوطنية' : 'National Compliance Stats', path: '/gov' },
  ];

  const links =
    role === 'driver' ? driverLinks
    : role === 'company' ? companyLinks
    : role === 'transport' ? transportLinks
    : role === 'recycler' ? recyclerLinks
    : role === 'reviewer' ? reviewerLinks
    : role === 'branch' ? branchLinks
    : role === 'consultant' ? consultantLinks
    : role === 'gov' ? govLinks
    // Admin shell: explicit per-actual-role nav, keyed by the real MemberRole
    // (not the shell-role prop, which is just 'admin' for all 5 Maya-side
    // roles). Falls closed to the most restrictive nav (Dashboard-only) if
    // the actual role is somehow unmapped — never opens to the full nav.
    : (adminShellLinksByActualRole[user?.role ?? ''] ?? dashboardOnlyLinks);

  // border-e (logical), not border-l: the sidebar sits at the START side
  // (left LTR / right RTL, via flex-row reversal on its parent) — the
  // border must be on whichever side actually FACES the content, which is
  // the END side either way.
  const sidebarContent = (
    <div className="flex flex-col h-full bg-card border-e border-border shadow-soft">
      <div className="p-8 border-b border-border">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 bg-gradient-primary rounded-2xl flex items-center justify-center shadow-medium p-1">
            <Logo className="w-full h-full" />
          </div>
          <div>
            <h2 className="font-bold text-foreground text-lg">
              {isRTL ? 'سند 360' : 'Sanad 360'}
            </h2>
            <p className="text-sm text-muted-foreground">
              {role === 'driver' && (isRTL ? 'سائق' : 'Driver')}
              {role === 'company' && (isRTL ? 'منشأة' : 'Company')}
              {role === 'transport' && (isRTL ? 'شركة نقل' : 'Transport')}
              {role === 'recycler' && (isRTL ? 'منشأة إعادة تدوير' : 'Recycler')}
              {role === 'admin' && (adminShellLabel[user?.role ?? ''] ?? adminShellLabel.admin)}
              {role === 'reviewer' && (isRTL ? 'مراجع مستندات' : 'Document Reviewer')}
              {role === 'branch' && (isRTL ? 'مشغل فرع' : 'Branch Operator')}
              {role === 'consultant' && (isRTL ? 'مستشار' : 'Consultant')}
              {role === 'gov' && (isRTL ? 'جهة حكومية' : 'Government')}
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
              <link.icon className="w-5 h-5 me-3" />
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
            onClick={() => { navigate('/profile'); setIsOpen(false); }}
          >
            <SettingsIcon className="w-5 h-5 me-3" />
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
          <LogOutIcon className="w-4 h-4 me-2" />
          <span className="font-medium">{isRTL ? 'تسجيل الخروج' : 'Logout'}</span>
        </Button>
        <p className="text-[11px] text-muted-foreground text-center mt-4">
          {isRTL ? 'مدعوم من ' : 'Powered by '}
          <span className="font-semibold" dir="ltr">Maya AI</span>
        </p>
      </div>
    </div>
  );

  // CP7 field-mode fix: the driver role already gets its own mobile nav
  // (DriverBottomNav, rendered by AppShell) — the hamburger toggle + slide-in
  // drawer below were still rendering on top of it for role="driver" too,
  // giving a driver on mobile TWO different navigation affordances (bottom
  // tabs AND a hamburger drawer with a third, overlapping set of links),
  // exactly the "full app chrome increases mis-tap risk" gap the CP7 field-
  // role inventory flagged. Mobile-only (desktop still gets the same
  // <aside> as every other role — this isn't a driver-specific concern
  // there, since there's no bottom nav rendered on desktop either).
  const showMobileDrawer = role !== 'driver';

  return (
    <>
      {showMobileDrawer && (
        <Button
          variant="ghost"
          size="icon"
          // CP7: was `right-4` unconditionally — the desktop sidebar sits at
          // the START side (left in LTR, right in RTL, via natural flex-row
          // reversal on its parent, no logical utility needed there). This
          // mobile toggle+drawer are a separate, hardcoded-right pair that
          // never matched that in LTR mode. `start-4` aligns it with wherever
          // the sidebar itself actually is, in either language.
          className="lg:hidden fixed top-4 start-4 z-50 bg-card text-foreground hover:bg-accent hover:text-accent-foreground"
          onClick={() => setIsOpen(!isOpen)}
          aria-label={isRTL ? 'القائمة' : 'Menu'}
        >
          {isOpen ? <XIcon className="w-6 h-6" /> : <MenuIcon className="w-6 h-6" />}
        </Button>
      )}

      <aside className="hidden lg:block w-64 h-screen sticky top-0">{sidebarContent}</aside>

      {showMobileDrawer && isOpen && (
        <>
          <div
            className="lg:hidden fixed inset-0 bg-gray-900/50 z-40"
            onClick={() => setIsOpen(false)}
          />
          <aside className="lg:hidden fixed top-0 start-0 w-64 h-screen z-50">{sidebarContent}</aside>
        </>
      )}
    </>
  );
}
