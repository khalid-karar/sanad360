import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { homeRouteFor } from '../lib/roleRouting';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { GlobeIcon, AlertCircleIcon } from 'lucide-react';
import PageTransition from '../components/animations/PageTransition';
import FadeInUp from '../components/animations/FadeInUp';
import ScaleIn from '../components/animations/ScaleIn';
import InteractiveButton from '../components/animations/InteractiveButton';
import FAQModal from '../components/FAQModal';
import Logo from '../components/Logo';

/**
 * A bare Saudi mobile number (only digits, optionally with a leading 0 or
 * +966) is treated as a driver phone login and converted to the synthetic
 * email format used in auth. Anything containing "@" is passed straight
 * through as an email. This one form now serves every role — the server
 * resolves the membership and its role; there is no client-side role
 * picker to get out of sync (previously 3 separate tabs plus a duplicated
 * role→route map in 3 files, see src/lib/roleRouting.ts).
 */
function resolveLoginEmail(identifier: string): string {
  const trimmed = identifier.trim();
  if (trimmed.includes('@')) return trimmed;
  const digits = trimmed.replace(/\D/g, '');
  return `${digits}@driver.sanad360.com`;
}

export default function LoginPage() {
  const navigate = useNavigate();
  const { login, isRTL, toggleLanguage, isLoading, error, clearError } = useAuthStore();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showFaq, setShowFaq] = useState(false);

  const handleLogin = async () => {
    if (!identifier || !password) return;
    try {
      await login(resolveLoginEmail(identifier), password);
      const { user } = useAuthStore.getState();
      if (!user) return;
      navigate(homeRouteFor(user));
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
          <Card variant="elevated" className="w-full max-w-md bg-card/95 backdrop-blur-sm text-card-foreground border-border z-10 relative">
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
                <div className="space-y-4">
                  {errorBanner}
                  <div className="space-y-2">
                    <Label htmlFor="login-identifier" className="text-foreground">
                      {isRTL ? 'البريد الإلكتروني أو رقم الهاتف' : 'Email or Phone Number'}
                    </Label>
                    <Input
                      id="login-identifier"
                      type="text"
                      placeholder={isRTL ? 'you@example.com أو 05xxxxxxxx' : 'you@example.com or 05xxxxxxxx'}
                      value={identifier}
                      onChange={(e) => { setIdentifier(e.target.value); clearError(); }}
                      className="bg-background text-foreground border-input"
                      dir="ltr"
                      autoComplete="username"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="login-password" className="text-foreground">
                      {isRTL ? 'كلمة المرور' : 'Password'}
                    </Label>
                    <Input
                      id="login-password"
                      type="password"
                      placeholder="••••••••"
                      value={password}
                      onChange={(e) => { setPassword(e.target.value); clearError(); }}
                      className="bg-background text-foreground border-input"
                      autoComplete="current-password"
                      onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
                    />
                  </div>
                  <InteractiveButton
                    onClick={handleLogin}
                    className="w-full bg-primary text-primary-foreground hover:bg-primary/90"
                    hapticFeedback
                    soundFeedback
                    disabled={isLoading || !identifier || !password}
                  >
                    {isLoading ? (isRTL ? 'جارٍ الدخول...' : 'Signing in...') : (isRTL ? 'تسجيل الدخول' : 'Login')}
                  </InteractiveButton>
                </div>
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
