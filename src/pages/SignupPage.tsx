import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { signupApplicant } from '../lib/api/applications';
import { listIndustries } from '../lib/api/industries';
import type { Industry } from '../lib/database.types';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { GlobeIcon, CheckCircle2Icon, Loader2Icon } from 'lucide-react';
import PageTransition from '../components/animations/PageTransition';
import Logo from '../components/Logo';

type TenantType = 'company' | 'transport_company';

const CR_RE = /^\d{10}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^\+?[0-9]{7,15}$/;

/**
 * Public, unauthenticated self-service signup — info only, NO file upload
 * here (documents are collected after email verification, during the
 * pending_documents stage — see ApplicationStatusPage). Client-side format
 * validation mirrors services/pdf's own checks so a well-formed submission
 * essentially never gets a specific server error back; whatever the server
 * does respond with, this page shows the SAME ambiguous confirmation either
 * way (see signupApplicant's own comment) — the UI never branches on
 * response content, so it can't leak whether an email or CR already existed.
 */
export default function SignupPage() {
  const { isRTL, toggleLanguage } = useAuthStore();

  const [tenantType, setTenantType] = useState<TenantType>('company');
  const [nameAr, setNameAr] = useState('');
  const [nameEn, setNameEn] = useState('');
  const [cr, setCr] = useState('');
  const [vat, setVat] = useState('');
  const [industryCode, setIndustryCode] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [password, setPassword] = useState('');

  const [industries, setIndustries] = useState<Industry[]>([]);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [networkError, setNetworkError] = useState(false);

  useEffect(() => {
    if (tenantType !== 'company') return;
    let cancelled = false;
    (async () => {
      try {
        const rows = await listIndustries();
        if (!cancelled) setIndustries(rows);
      } catch {
        // Non-fatal — the field just shows no options; format validation
        // below still requires a selection for company applications.
      }
    })();
    return () => { cancelled = true; };
  }, [tenantType]);

  function validate(): string | null {
    if (!nameAr.trim()) return isRTL ? 'الاسم بالعربي مطلوب' : 'Name (Arabic) is required';
    if (!CR_RE.test(cr.trim())) return isRTL ? 'السجل التجاري يجب أن يتكون من 10 أرقام' : 'Commercial registration must be a 10-digit number';
    if (!EMAIL_RE.test(contactEmail.trim())) return isRTL ? 'البريد الإلكتروني غير صحيح' : 'Enter a valid email address';
    if (contactPhone.trim() && !PHONE_RE.test(contactPhone.trim())) return isRTL ? 'رقم الهاتف غير صحيح' : 'Enter a valid phone number';
    if (password.length < 8) return isRTL ? 'كلمة المرور 8 أحرف على الأقل' : 'Password must be at least 8 characters';
    if (tenantType === 'company' && !industryCode) return isRTL ? 'يرجى اختيار القطاع' : 'Please select an industry';
    return null;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const err = validate();
    if (err) {
      setFieldError(err);
      return;
    }
    setFieldError(null);
    setNetworkError(false);
    setSubmitting(true);
    try {
      await signupApplicant({
        tenant_type: tenantType,
        name_ar: nameAr.trim(),
        name_en: nameEn.trim() || undefined,
        commercial_registration: cr.trim(),
        vat_number: vat.trim() || undefined,
        industry_code: tenantType === 'company' ? industryCode : undefined,
        contact_email: contactEmail.trim(),
        contact_phone: contactPhone.trim() || undefined,
        password,
        locale: isRTL ? 'ar' : 'en',
      });
      setSubmitted(true);
    } catch {
      // Only a genuine network failure (couldn't reach the server at all)
      // lands here — see signupApplicant's comment on why every completed
      // HTTP response, whatever its status, is treated as ambiguous success.
      setNetworkError(true);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <PageTransition>
      <div className={`min-h-screen flex items-center justify-center bg-gradient-to-br from-background via-muted/30 to-background p-6 ${isRTL ? 'rtl' : 'ltr'}`}>
        <div className="w-full max-w-lg space-y-4">
          <div className="flex justify-start">
            <Button
              variant="outline"
              size="sm"
              onClick={toggleLanguage}
              className="bg-card/80 backdrop-blur-sm text-foreground border-border hover:bg-accent hover:text-accent-foreground shadow-soft"
            >
              <GlobeIcon className="w-4 h-4 me-2" />
              {isRTL ? 'English' : 'العربية'}
            </Button>
          </div>

          <Card variant="elevated" className="w-full bg-card/95 backdrop-blur-sm text-card-foreground border-border">
            <CardHeader className="text-center space-y-4">
              <div className="flex justify-center mb-2">
                <div className="w-16 h-16 bg-primary rounded-2xl flex items-center justify-center p-2">
                  <Logo className="w-full h-full" />
                </div>
              </div>
              <CardTitle className="text-2xl font-bold text-gradient-primary">
                {isRTL ? 'تقديم طلب انضمام' : 'Apply to Join'}
              </CardTitle>
              <CardDescription className="text-muted-foreground">
                {isRTL
                  ? 'أدخل بيانات منشأتك — سنرسل رابط تأكيد إلى بريدك الإلكتروني'
                  : "Enter your organization's details — we'll email you a confirmation link"}
              </CardDescription>
            </CardHeader>

            <CardContent>
              {submitted ? (
                <div className="space-y-4 text-center py-6">
                  <CheckCircle2Icon className="w-12 h-12 text-success mx-auto" aria-hidden />
                  <p className="text-foreground font-semibold" role="status">
                    {isRTL
                      ? 'إذا كانت هذه المعلومات جديدة لدينا، ستصلك رسالة تأكيد بريد إلكتروني قريباً.'
                      : 'If this information is new to us, you will receive a verification email shortly.'}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {isRTL
                      ? 'افتح الرابط الموجود في الرسالة خلال 24 ساعة لإكمال طلبك.'
                      : 'Open the link in that email within 24 hours to continue your application.'}
                  </p>
                  <Link to="/login" className="text-sm text-primary hover:text-primary/80 block">
                    {isRTL ? 'العودة لتسجيل الدخول' : 'Back to login'}
                  </Link>
                </div>
              ) : (
                <form onSubmit={handleSubmit} className="space-y-4" noValidate>
                  <div>
                    <Label className="text-foreground">{isRTL ? 'نوع المنشأة' : 'Organization Type'}</Label>
                    <div className="flex gap-4 mt-2">
                      <label className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
                        <input
                          type="radio"
                          name="tenant_type"
                          value="company"
                          checked={tenantType === 'company'}
                          onChange={() => setTenantType('company')}
                        />
                        {isRTL ? 'منشأة' : 'Company'}
                      </label>
                      <label className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
                        <input
                          type="radio"
                          name="tenant_type"
                          value="transport_company"
                          checked={tenantType === 'transport_company'}
                          onChange={() => setTenantType('transport_company')}
                        />
                        {isRTL ? 'شركة نقل' : 'Transport Company'}
                      </label>
                    </div>
                  </div>

                  <div>
                    <Label htmlFor="su-name-ar" className="text-foreground">{isRTL ? 'الاسم (عربي)' : 'Name (Arabic)'} *</Label>
                    <Input id="su-name-ar" value={nameAr} onChange={(e) => setNameAr(e.target.value)} required dir="rtl"
                      className="bg-background text-foreground border-input" />
                  </div>

                  <div>
                    <Label htmlFor="su-name-en" className="text-foreground">{isRTL ? 'الاسم (إنجليزي)' : 'Name (English)'}</Label>
                    <Input id="su-name-en" value={nameEn} onChange={(e) => setNameEn(e.target.value)} dir="ltr"
                      className="bg-background text-foreground border-input" />
                  </div>

                  <div>
                    <Label htmlFor="su-cr" className="text-foreground">{isRTL ? 'السجل التجاري' : 'Commercial Registration'} *</Label>
                    <Input id="su-cr" value={cr} onChange={(e) => setCr(e.target.value)} required dir="ltr" inputMode="numeric"
                      placeholder="1234567890" className="bg-background text-foreground border-input" />
                  </div>

                  <div>
                    <Label htmlFor="su-vat" className="text-foreground">{isRTL ? 'الرقم الضريبي' : 'VAT Number'}</Label>
                    <Input id="su-vat" value={vat} onChange={(e) => setVat(e.target.value)} dir="ltr"
                      className="bg-background text-foreground border-input" />
                  </div>

                  {tenantType === 'company' && (
                    <div>
                      <Label htmlFor="su-industry" className="text-foreground">{isRTL ? 'القطاع' : 'Industry'} *</Label>
                      <select
                        id="su-industry"
                        value={industryCode}
                        onChange={(e) => setIndustryCode(e.target.value)}
                        required
                        className="mt-2 w-full bg-background text-foreground border border-input rounded-md px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <option value="">{isRTL ? '— اختر القطاع —' : '— Select an industry —'}</option>
                        {industries.map((ind) => (
                          <option key={ind.code} value={ind.code}>{isRTL ? ind.label_ar : ind.label_en}</option>
                        ))}
                      </select>
                    </div>
                  )}

                  <div>
                    <Label htmlFor="su-email" className="text-foreground">{isRTL ? 'البريد الإلكتروني' : 'Contact Email'} *</Label>
                    <Input id="su-email" type="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} required dir="ltr"
                      autoComplete="email" className="bg-background text-foreground border-input" />
                  </div>

                  <div>
                    <Label htmlFor="su-phone" className="text-foreground">{isRTL ? 'رقم الهاتف' : 'Contact Phone'}</Label>
                    <Input id="su-phone" value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} dir="ltr"
                      placeholder="+9665xxxxxxxx" className="bg-background text-foreground border-input" />
                  </div>

                  <div>
                    <Label htmlFor="su-password" className="text-foreground">{isRTL ? 'كلمة المرور' : 'Password'} *</Label>
                    <Input id="su-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required
                      autoComplete="new-password" className="bg-background text-foreground border-input" />
                  </div>

                  {fieldError && <p className="text-sm text-destructive" role="alert">{fieldError}</p>}
                  {networkError && (
                    <p className="text-sm text-destructive" role="alert">
                      {isRTL ? 'تعذر الاتصال بالخادم. يرجى المحاولة مرة أخرى.' : 'Could not reach the server. Please try again.'}
                    </p>
                  )}

                  <Button type="submit" disabled={submitting} className="w-full gap-2 bg-primary text-primary-foreground hover:bg-primary/90">
                    {submitting && <Loader2Icon className="w-4 h-4 animate-spin" />}
                    {isRTL ? 'تقديم الطلب' : 'Submit Application'}
                  </Button>

                  <p className="text-center text-sm text-muted-foreground">
                    {isRTL ? 'لديك حساب بالفعل؟' : 'Already have an account?'}{' '}
                    <Link to="/login" className="text-primary hover:text-primary/80">
                      {isRTL ? 'تسجيل الدخول' : 'Log in'}
                    </Link>
                  </p>
                </form>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </PageTransition>
  );
}
