import { useEffect, useState } from 'react';
import { useAuthStore } from '../../stores/authStore';
import { supabase } from '../../lib/supabase';
import type { TransportCompany } from '../../lib/database.types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { XIcon, Loader2Icon, CheckCircle2Icon } from 'lucide-react';
import { PDF_SERVICE_URL } from '../../lib/pdfServiceUrl';

type TenantType = 'company' | 'transport_company';

interface OnboardResult {
  companyId: string;
  userId: string;
  profileId: string;
  warnings?: string[];
}

interface OnboardCompanyFormProps {
  onClose: () => void;
  /** Called after a successful onboarding so the parent can refresh its list. */
  onSuccess?: (result: OnboardResult) => void;
}

export default function OnboardCompanyForm({ onClose, onSuccess }: OnboardCompanyFormProps) {
  const { isRTL } = useAuthStore();

  const [tenantType, setTenantType] = useState<TenantType>('company');
  const [nameAr, setNameAr] = useState('');
  const [nameEn, setNameEn] = useState('');
  const [cr, setCr] = useState('');
  const [vat, setVat] = useState('');
  const [ownerNameAr, setOwnerNameAr] = useState('');
  const [ownerEmail, setOwnerEmail] = useState('');
  const [ownerPassword, setOwnerPassword] = useState('');

  // Transport companies to link (company tenants only).
  const [transportCompanies, setTransportCompanies] = useState<TransportCompany[]>([]);
  const [selectedTcIds, setSelectedTcIds] = useState<string[]>([]);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<OnboardResult | null>(null);

  // Load the transport-company catalog (admin can read all via RLS) so the
  // operator can link them at company-creation time.
  useEffect(() => {
    if (tenantType !== 'company') return;
    let cancelled = false;
    (async () => {
      const { data, error: tcErr } = await supabase
        .from('transport_companies')
        .select('*')
        .order('name_ar');
      if (cancelled) return;
      if (!tcErr && data) setTransportCompanies(data as TransportCompany[]);
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantType]);

  function toggleTc(id: string) {
    setSelectedTcIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setError(isRTL ? 'انتهت الجلسة. سجّل الدخول مرة أخرى.' : 'Session expired. Please sign in again.');
        setSubmitting(false);
        return;
      }

      const payload = {
        tenant_type: tenantType,
        name_ar: nameAr,
        name_en: nameEn || undefined,
        commercial_registration: cr,
        vat_number: vat || undefined,
        owner_name_ar: ownerNameAr,
        owner_email: ownerEmail,
        owner_temp_password: ownerPassword,
        transport_company_ids:
          tenantType === 'company' && selectedTcIds.length > 0 ? selectedTcIds : undefined,
      };

      const res = await fetch(`${PDF_SERVICE_URL}/admin/onboard-company`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify(payload),
      });

      if (res.status === 403) {
        setError(isRTL ? 'ليس لديك صلاحية' : 'Not authorized');
        return;
      }
      if (!res.ok) {
        let message = isRTL ? 'فشل إنشاء المنشأة' : 'Failed to onboard company';
        try {
          const json = (await res.json()) as { error?: string };
          if (json.error) message = json.error;
        } catch {
          /* ignore parse error */
        }
        setError(message);
        return;
      }

      const data = (await res.json()) as OnboardResult;
      setResult(data);
      onSuccess?.(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : isRTL ? 'خطأ في الشبكة' : 'Network error');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    // z-[1200]: this form renders on AdminDashboard alongside <ComplianceMap/>
    // (a Leaflet map). Leaflet's own panes/controls use z-index up to 1000,
    // so the previous z-50 here rendered the form BEHIND the map.
    <div className="fixed inset-0 z-[1200] flex items-center justify-center bg-gray-900/50 p-4">
      <Card className={`w-full max-w-lg max-h-[90vh] overflow-y-auto bg-card text-card-foreground border-border ${isRTL ? 'rtl' : 'ltr'}`}>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>
            {tenantType === 'transport_company'
              ? (isRTL ? 'إضافة شركة نقل جديدة' : 'Add New Transport Company')
              : (isRTL ? 'إضافة منشأة جديدة' : 'Add New Company')}
          </CardTitle>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label={isRTL ? 'إغلاق' : 'Close'}>
            <XIcon className="w-5 h-5" />
          </Button>
        </CardHeader>
        <CardContent>
          {result ? (
            <div className="space-y-4 text-center py-6">
              <CheckCircle2Icon className="w-12 h-12 text-success mx-auto" />
              <p className="text-foreground font-semibold">
                {isRTL ? 'تم إنشاء المنشأة بنجاح' : 'Company onboarded successfully'}
              </p>
              <p className="text-sm text-muted-foreground">
                {isRTL ? 'معرف المنشأة:' : 'Company ID:'}{' '}
                <span className="font-mono text-foreground">{result.companyId}</span>
              </p>
              {result.warnings && result.warnings.length > 0 && (
                <div className="text-start text-xs text-destructive bg-destructive/10 rounded-md p-3">
                  <p className="font-medium mb-1">
                    {isRTL ? 'تحذيرات الربط:' : 'Link warnings:'}
                  </p>
                  <ul className="list-disc ms-4 space-y-1">
                    {result.warnings.map((w, i) => (
                      <li key={i} className="font-mono break-all">{w}</li>
                    ))}
                  </ul>
                </div>
              )}
              <Button onClick={onClose} className="mt-2">
                {isRTL ? 'تم' : 'Done'}
              </Button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Tenant type radio */}
              <div>
                <Label className="text-foreground">{isRTL ? 'نوع المنشأة' : 'Tenant Type'}</Label>
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
                <Label htmlFor="name_ar" className="text-foreground">
                  {isRTL ? 'الاسم (عربي)' : 'Name (Arabic)'} *
                </Label>
                <Input id="name_ar" value={nameAr} onChange={(e) => setNameAr(e.target.value)} required dir="rtl" />
              </div>

              <div>
                <Label htmlFor="name_en" className="text-foreground">
                  {isRTL ? 'الاسم (إنجليزي)' : 'Name (English)'}
                </Label>
                <Input id="name_en" value={nameEn} onChange={(e) => setNameEn(e.target.value)} dir="ltr" />
              </div>

              <div>
                <Label htmlFor="cr" className="text-foreground">
                  {isRTL ? 'السجل التجاري' : 'Commercial Registration'} *
                </Label>
                <Input id="cr" value={cr} onChange={(e) => setCr(e.target.value)} required dir="ltr" />
              </div>

              <div>
                <Label htmlFor="vat" className="text-foreground">
                  {isRTL ? 'الرقم الضريبي' : 'VAT Number'}
                </Label>
                <Input id="vat" value={vat} onChange={(e) => setVat(e.target.value)} dir="ltr" />
              </div>

              {/* Link transport companies (company tenants only) */}
              {tenantType === 'company' && (
                <div>
                  <Label className="text-foreground">
                    {isRTL ? 'ربط شركات النقل' : 'Link transport companies'}
                  </Label>
                  {transportCompanies.length === 0 ? (
                    <p className="text-xs text-muted-foreground mt-2">
                      {isRTL ? 'لا توجد شركات نقل متاحة' : 'No transport companies available'}
                    </p>
                  ) : (
                    <div className="mt-2 max-h-40 overflow-y-auto border border-input rounded-md p-2 space-y-1">
                      {transportCompanies.map((tc) => (
                        <label
                          key={tc.id}
                          className="flex items-center gap-2 text-sm text-foreground cursor-pointer py-1"
                        >
                          <input
                            type="checkbox"
                            checked={selectedTcIds.includes(tc.id)}
                            onChange={() => toggleTc(tc.id)}
                          />
                          <span>
                            {tc.name_ar}
                            {tc.name_en ? ` — ${tc.name_en}` : ''}
                          </span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <div className="border-t border-border pt-4 space-y-4">
                <p className="text-sm font-medium text-muted-foreground">
                  {isRTL ? 'بيانات المالك' : 'Owner Account'}
                </p>

                <div>
                  <Label htmlFor="owner_name_ar" className="text-foreground">
                    {isRTL ? 'اسم المالك (عربي)' : 'Owner Name (Arabic)'} *
                  </Label>
                  <Input
                    id="owner_name_ar"
                    value={ownerNameAr}
                    onChange={(e) => setOwnerNameAr(e.target.value)}
                    required
                    dir="rtl"
                  />
                </div>

                <div>
                  <Label htmlFor="owner_email" className="text-foreground">
                    {isRTL ? 'البريد الإلكتروني للمالك' : 'Owner Email'} *
                  </Label>
                  <Input
                    id="owner_email"
                    type="email"
                    value={ownerEmail}
                    onChange={(e) => setOwnerEmail(e.target.value)}
                    required
                    dir="ltr"
                  />
                </div>

                <div>
                  <Label htmlFor="owner_pw" className="text-foreground">
                    {isRTL ? 'كلمة مرور مؤقتة' : 'Temporary Password'} *
                  </Label>
                  <Input
                    id="owner_pw"
                    type="text"
                    value={ownerPassword}
                    onChange={(e) => setOwnerPassword(e.target.value)}
                    required
                    dir="ltr"
                  />
                </div>
              </div>

              {error && <p className="text-sm text-destructive">{error}</p>}

              <div className="flex gap-3 pt-2">
                <Button type="submit" disabled={submitting} className="gap-2">
                  {submitting && <Loader2Icon className="w-4 h-4 animate-spin" />}
                  {isRTL ? 'إنشاء المنشأة' : 'Create Company'}
                </Button>
                <Button type="button" variant="outline" onClick={onClose}>
                  {isRTL ? 'إلغاء' : 'Cancel'}
                </Button>
              </div>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
