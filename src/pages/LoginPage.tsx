import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Building2Icon, ShieldIcon, GlobeIcon, PackageIcon, FingerprintIcon, AlertCircleIcon } from 'lucide-react';
import { Separator } from '@/components/ui/separator';
import PageTransition from '../components/animations/PageTransition';
import FadeInUp from '../components/animations/FadeInUp';
import ScaleIn from '../components/animations/ScaleIn';
import InteractiveButton from '../components/animations/InteractiveButton';
import FAQModal from '../components/FAQModal';
import Logo from '../components/Logo';

type LoginTab = 'driver' | 'company' | 'admin' | 'transport';

/** Converts a driver's phone number to the synthetic email format used in auth. */
function phoneToDriverEmail(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  return `${digits}@driver.sanad360.com`;
}

export default function LoginPage() {
  const navigate = useNavigate();
  const { login, isRTL, toggleLanguage, isLoading, error, clearError } = useAuthStore();
  const [activeTab, setActiveTab] = useState<LoginTab>('driver');

  // Per-tab field state
  const [driverPhone, setDriverPhone] = useState('');
  const [driverPassword, setDriverPassword] = useState('');
  const [companyEmail, setCompanyEmail] = useState('');
  const [companyPassword, setCompanyPassword] = useState('');
  const [transportEmail, setTransportEmail] = useState('');
  const [transportPassword, setTransportPassword] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [adminPassword, setAdminPassword] = useState('');

  const [showFaq, setShowFaq] = useState(false);

  const handleTabChange = (v: string) => {
    setActiveTab(v as LoginTab);
    clearError();
  };

  const handleLogin = async (tab: LoginTab) => {
    let email = '';
    let password = '';

    switch (tab) {
      case 'driver':
        email = phoneToDriverEmail(driverPhone);
        password = driverPassword;
        break;
      case 'company':
        email = companyEmail;
        password = companyPassword;
        break;
      case 'transport':
        email = transportEmail;
        password = transportPassword;
        break;
      case 'admin':
        email = adminEmail;
        password = adminPassword;
        break;
    }

    try {
      await login(email, password);
      const { user } = useAuthStore.getState();
      if (!user) return;
      // owner/manager exist on BOTH company and transport-company tenants, so
      // the destination can't be a static role→route map (that previously
      // sent every owner/manager to /company, even a transport company's own
      // owner/manager signing in from the Transport tab). Route by which
      // tenant field the active membership actually set instead.
      if (user.role === 'admin') navigate('/admin');
      else if (user.role === 'driver') navigate('/driver');
      else if (user.transport_company_id) navigate('/transport');
      else navigate('/company');
    } catch {
      // error is already set in the store
    }
  };

  const errorBanner = error ? (
    <div className="flex items-center gap-2 rounded-md bg-destructive/10 border border-destructive/30 p-3 text-sm text-destructive">
      <AlertCircleIcon className="w-4 h-4 flex-shrink-0" />
      <span>{isRTL ? 'خطأ في تسجيل الدخول: ' : 'Login error: '}{error}</span>
    </div>
  ) : null;

  return (
    <PageTransition>
      <div className={`min-h-screen flex items-center justify-center bg-gradient-to-br from-background via-muted/30 to-background p-6 ${isRTL ? 'rtl' : 'ltr'}`}>
        <FadeInUp delay={0.1}>
          <div className="absolute top-4 start-4 z-10">
            <InteractiveButton
              variant="outline"
              size="sm"
              onClick={toggleLanguage}
              className="bg-card/80 backdrop-blur-sm text-foreground border-border hover:bg-accent hover:text-accent-foreground shadow-soft"
              hapticFeedback
            >
              <GlobeIcon className="w-4 h-4 me-2" />
              {isRTL ? 'English' : 'العربية'}
            </InteractiveButton>
          </div>
        </FadeInUp>

        <ScaleIn delay={0.2}>
          <Card variant="elevated" className="w-full max-w-lg bg-card/95 backdrop-blur-sm text-card-foreground border-border z-10 relative">
            <CardHeader className="text-center space-y-4">
              <FadeInUp delay={0.3}>
                <div className="flex justify-center mb-6">
                  <div className="w-20 h-20 bg-primary rounded-2xl flex items-center justify-center p-2">
                    <Logo className="w-full h-full" />
                  </div>
                </div>
              </FadeInUp>
              <FadeInUp delay={0.4}>
                <CardTitle className="text-3xl font-bold text-gradient-primary">
                  {isRTL ? 'سند 360' : 'Sanad 360'}
                </CardTitle>
              </FadeInUp>
              <FadeInUp delay={0.5}>
                <CardDescription className="text-muted-foreground text-base leading-relaxed">
                  {isRTL ? 'نظام إدارة النفايات والامتثال' : 'Waste Management & Compliance System'}
                </CardDescription>
              </FadeInUp>
            </CardHeader>

            <CardContent className="space-y-8">
              <FadeInUp delay={0.6}>
                <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
                  <div className="mb-10">
                    <TabsList className="grid w-full grid-cols-2 md:grid-cols-4 bg-muted/50 p-2 rounded-xl h-auto">
                      <TabsTrigger value="driver" className="data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm text-muted-foreground rounded-lg transition-all duration-200 flex flex-col items-center gap-2 py-3 px-3 h-16">
                        <Building2Icon className="w-4 h-4 flex-shrink-0" />
                        <span className="text-xs font-medium text-center leading-tight">{isRTL ? 'سائق' : 'Driver'}</span>
                      </TabsTrigger>
                      <TabsTrigger value="company" className="data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm text-muted-foreground rounded-lg transition-all duration-200 flex flex-col items-center gap-2 py-3 px-3 h-16">
                        <Building2Icon className="w-4 h-4 flex-shrink-0" />
                        <span className="text-xs font-medium text-center leading-tight">{isRTL ? 'منشأة' : 'Company'}</span>
                      </TabsTrigger>
                      <TabsTrigger value="transport" className="data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm text-muted-foreground rounded-lg transition-all duration-200 flex flex-col items-center gap-2 py-3 px-3 h-16">
                        <PackageIcon className="w-4 h-4 flex-shrink-0" />
                        <span className="text-xs font-medium text-center leading-tight">{isRTL ? 'شركة نقل' : 'Transport'}</span>
                      </TabsTrigger>
                      <TabsTrigger value="admin" className="data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm text-muted-foreground rounded-lg transition-all duration-200 flex flex-col items-center gap-2 py-3 px-3 h-16">
                        <ShieldIcon className="w-4 h-4 flex-shrink-0" />
                        <span className="text-xs font-medium text-center leading-tight">{isRTL ? 'مسؤول' : 'Admin'}</span>
                      </TabsTrigger>
                    </TabsList>
                  </div>

                  {/* ── Driver ── */}
                  <TabsContent value="driver" className="space-y-4">
                    {errorBanner}
                    <div className="space-y-2">
                      <Label htmlFor="driver-phone" className="text-foreground">
                        {isRTL ? 'رقم الهاتف' : 'Phone Number'}
                      </Label>
                      <Input
                        id="driver-phone"
                        type="tel"
                        placeholder="05xxxxxxxx"
                        value={driverPhone}
                        onChange={(e) => setDriverPhone(e.target.value)}
                        className="bg-background text-foreground border-input"
                        dir="ltr"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="driver-password" className="text-foreground">
                        {isRTL ? 'كلمة المرور' : 'Password'}
                      </Label>
                      <Input
                        id="driver-password"
                        type="password"
                        placeholder="••••••••"
                        value={driverPassword}
                        onChange={(e) => setDriverPassword(e.target.value)}
                        className="bg-background text-foreground border-input"
                        onKeyDown={(e) => e.key === 'Enter' && handleLogin('driver')}
                      />
                    </div>
                    <InteractiveButton
                      onClick={() => handleLogin('driver')}
                      className="w-full bg-primary text-primary-foreground hover:bg-primary/90"
                      hapticFeedback
                      soundFeedback
                      disabled={isLoading || !driverPhone || !driverPassword}
                    >
                      {isLoading ? (isRTL ? 'جارٍ الدخول...' : 'Signing in...') : (isRTL ? 'تسجيل الدخول' : 'Login')}
                    </InteractiveButton>
                    <Separator className="my-6" />
                    <InteractiveButton
                      disabled
                      className="w-full bg-secondary text-secondary-foreground hover:bg-secondary/80 opacity-60 cursor-not-allowed"
                      hapticFeedback={false}
                    >
                      <FingerprintIcon className="w-4 h-4 mr-2" />
                      {isRTL ? 'تسجيل الدخول عبر نفاذ (قريباً)' : 'Login with Nafaz (Coming Soon)'}
                    </InteractiveButton>
                  </TabsContent>

                  {/* ── Company ── */}
                  <TabsContent value="company" className="space-y-4">
                    {errorBanner}
                    <div className="space-y-2">
                      <Label htmlFor="company-email" className="text-foreground">
                        {isRTL ? 'البريد الإلكتروني' : 'Email'}
                      </Label>
                      <Input
                        id="company-email"
                        type="email"
                        placeholder="manager@company.com"
                        value={companyEmail}
                        onChange={(e) => setCompanyEmail(e.target.value)}
                        className="bg-background text-foreground border-input"
                        dir="ltr"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="company-password" className="text-foreground">
                        {isRTL ? 'كلمة المرور' : 'Password'}
                      </Label>
                      <Input
                        id="company-password"
                        type="password"
                        placeholder="••••••••"
                        value={companyPassword}
                        onChange={(e) => setCompanyPassword(e.target.value)}
                        className="bg-background text-foreground border-input"
                        onKeyDown={(e) => e.key === 'Enter' && handleLogin('company')}
                      />
                    </div>
                    <InteractiveButton
                      onClick={() => handleLogin('company')}
                      className="w-full bg-primary text-primary-foreground hover:bg-primary/90"
                      hapticFeedback
                      soundFeedback
                      disabled={isLoading || !companyEmail || !companyPassword}
                    >
                      {isLoading ? (isRTL ? 'جارٍ الدخول...' : 'Signing in...') : (isRTL ? 'تسجيل الدخول' : 'Login')}
                    </InteractiveButton>
                    <Separator className="my-6" />
                    <InteractiveButton
                      disabled
                      className="w-full bg-secondary text-secondary-foreground hover:bg-secondary/80 opacity-60 cursor-not-allowed"
                      hapticFeedback={false}
                    >
                      <FingerprintIcon className="w-4 h-4 mr-2" />
                      {isRTL ? 'تسجيل الدخول عبر نفاذ (قريباً)' : 'Login with Nafaz (Coming Soon)'}
                    </InteractiveButton>
                  </TabsContent>

                  {/* ── Transport ── */}
                  <TabsContent value="transport" className="space-y-4">
                    {errorBanner}
                    <div className="space-y-2">
                      <Label htmlFor="transport-email" className="text-foreground">
                        {isRTL ? 'البريد الإلكتروني' : 'Email'}
                      </Label>
                      <Input
                        id="transport-email"
                        type="email"
                        placeholder="dispatcher@transport.com"
                        value={transportEmail}
                        onChange={(e) => setTransportEmail(e.target.value)}
                        className="bg-background text-foreground border-input"
                        dir="ltr"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="transport-password" className="text-foreground">
                        {isRTL ? 'كلمة المرور' : 'Password'}
                      </Label>
                      <Input
                        id="transport-password"
                        type="password"
                        placeholder="••••••••"
                        value={transportPassword}
                        onChange={(e) => setTransportPassword(e.target.value)}
                        className="bg-background text-foreground border-input"
                        onKeyDown={(e) => e.key === 'Enter' && handleLogin('transport')}
                      />
                    </div>
                    <InteractiveButton
                      onClick={() => handleLogin('transport')}
                      className="w-full bg-primary text-primary-foreground hover:bg-primary/90"
                      hapticFeedback
                      soundFeedback
                      disabled={isLoading || !transportEmail || !transportPassword}
                    >
                      {isLoading ? (isRTL ? 'جارٍ الدخول...' : 'Signing in...') : (isRTL ? 'تسجيل الدخول' : 'Login')}
                    </InteractiveButton>
                  </TabsContent>

                  {/* ── Admin ── */}
                  <TabsContent value="admin" className="space-y-4">
                    {errorBanner}
                    <div className="space-y-2">
                      <Label htmlFor="admin-email" className="text-foreground">
                        {isRTL ? 'البريد الإلكتروني' : 'Email'}
                      </Label>
                      <Input
                        id="admin-email"
                        type="email"
                        placeholder="admin@sanad360.com"
                        value={adminEmail}
                        onChange={(e) => setAdminEmail(e.target.value)}
                        className="bg-background text-foreground border-input"
                        dir="ltr"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="admin-password" className="text-foreground">
                        {isRTL ? 'كلمة المرور' : 'Password'}
                      </Label>
                      <Input
                        id="admin-password"
                        type="password"
                        placeholder="••••••••"
                        value={adminPassword}
                        onChange={(e) => setAdminPassword(e.target.value)}
                        className="bg-background text-foreground border-input"
                        onKeyDown={(e) => e.key === 'Enter' && handleLogin('admin')}
                      />
                    </div>
                    <InteractiveButton
                      onClick={() => handleLogin('admin')}
                      className="w-full bg-primary text-primary-foreground hover:bg-primary/90"
                      hapticFeedback
                      soundFeedback
                      disabled={isLoading || !adminEmail || !adminPassword}
                    >
                      {isLoading ? (isRTL ? 'جارٍ الدخول...' : 'Signing in...') : (isRTL ? 'تسجيل الدخول' : 'Login')}
                    </InteractiveButton>
                  </TabsContent>
                </Tabs>
              </FadeInUp>

              <FadeInUp delay={0.8}>
                <div className="text-center space-y-3">
                  <button
                    onClick={() => setShowFaq(true)}
                    className="text-sm text-primary hover:text-primary/80 transition-colors duration-200 block w-full"
                  >
                    {isRTL ? 'الأسئلة الشائعة' : 'FAQ'}
                  </button>
                  <div className="text-sm text-muted-foreground">
                    {isRTL ? 'للمساعدة، اتصل بـ:' : 'For help, call:'}{' '}
                    <a href="tel:+966501234567" className="text-primary hover:text-primary/80 transition-colors duration-200">
                      <span dir="ltr">+966 50 123 4567</span>
                    </a>
                  </div>
                  <p className="text-xs text-muted-foreground pt-2 border-t border-border">
                    {isRTL ? 'مدعوم من ' : 'Powered by '}
                    <span className="font-semibold text-foreground" dir="ltr">Maya AI</span>
                  </p>
                </div>
              </FadeInUp>
            </CardContent>
          </Card>
        </ScaleIn>
      </div>
      {showFaq && <FAQModal onClose={() => setShowFaq(false)} />}
    </PageTransition>
  );
}
