import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { verifyEmailToken } from '../lib/api/applications';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CheckCircle2Icon, XCircleIcon } from 'lucide-react';
import { LoadingState } from '@/components/ui/states';
import PageTransition from '../components/animations/PageTransition';
import Logo from '../components/Logo';

type ViewState = 'checking' | 'success' | 'failure';

/**
 * Public /verify?token=... — reads the token from the URL and POSTs it to
 * the backend in the request BODY (not forwarded as a query string anywhere
 * past this point), so it never rides into any of this app's own logging.
 * Expired / invalid / already-used tokens are rendered as the SAME generic
 * failure state — the backend already collapses those cases into one
 * message; this page does not add any further distinction. The raw token
 * itself is never logged (no console.* touches it anywhere in this file).
 */
export default function VerifyEmailPage() {
  const { isRTL } = useAuthStore();
  const [searchParams] = useSearchParams();
  const [state, setState] = useState<ViewState>('checking');
  const [message, setMessage] = useState('');

  useEffect(() => {
    const token = searchParams.get('token');
    if (!token) {
      setState('failure');
      setMessage(isRTL ? 'رابط التحقق غير صالح.' : 'This verification link is invalid.');
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const result = await verifyEmailToken(token);
        if (cancelled) return;
        setState('success');
        setMessage(result.message);
      } catch (err) {
        if (cancelled) return;
        setState('failure');
        setMessage(
          err instanceof Error
            ? err.message
            : (isRTL ? 'رابط التحقق غير صالح أو منتهي الصلاحية.' : 'This verification link is invalid or has expired.')
        );
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  return (
    <PageTransition>
      <div className={`min-h-screen flex items-center justify-center bg-gradient-to-br from-background via-muted/30 to-background p-6 ${isRTL ? 'rtl' : 'ltr'}`}>
        <div className="w-full max-w-md">
          <Card variant="elevated" className="w-full bg-card/95 backdrop-blur-sm text-card-foreground border-border">
            <CardHeader className="text-center space-y-4">
              <div className="flex justify-center mb-2">
                <div className="w-16 h-16 bg-primary rounded-2xl flex items-center justify-center p-2">
                  <Logo className="w-full h-full" />
                </div>
              </div>
              <CardTitle className="text-2xl font-bold text-gradient-primary">
                {isRTL ? 'تأكيد البريد الإلكتروني' : 'Email Verification'}
              </CardTitle>
            </CardHeader>
            <CardContent className="text-center space-y-4 pb-8">
              {state === 'checking' && <LoadingState label={isRTL ? 'جارٍ التحقق' : 'Verifying'} />}

              {state === 'success' && (
                <div className="space-y-3">
                  <CheckCircle2Icon className="w-12 h-12 text-success mx-auto" aria-hidden />
                  <p className="text-foreground font-semibold" role="status">{message}</p>
                  <Link
                    to="/login"
                    className="inline-block mt-2 text-primary hover:text-primary/80 font-medium"
                  >
                    {isRTL ? 'تسجيل الدخول الآن' : 'Log in now'}
                  </Link>
                </div>
              )}

              {state === 'failure' && (
                <div className="space-y-3">
                  <XCircleIcon className="w-12 h-12 text-destructive mx-auto" aria-hidden />
                  <p className="text-destructive font-semibold" role="alert">{message}</p>
                  <Link to="/signup" className="inline-block mt-2 text-primary hover:text-primary/80 font-medium">
                    {isRTL ? 'تقديم طلب جديد' : 'Start a new application'}
                  </Link>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </PageTransition>
  );
}
