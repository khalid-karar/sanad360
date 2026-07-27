import { useEffect, useState } from 'react';
import { useAuthStore } from '../stores/authStore';
import { getMyProfile, updateProfile } from '../lib/api/profile';
import AppShell from '../components/AppShell';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { UserIcon } from 'lucide-react';
import { LoadingState, ErrorState } from '@/components/ui/states';

type AppRole = 'company' | 'transport' | 'driver' | 'admin';

// owner/manager exist on both company and transport-company tenants, so role
// alone can't pick the shell (dispatcher is transport-only, hence the
// special case) — same tenant-field check as LoginPage.tsx/App.tsx.
function shellRole(user: { role?: string; transport_company_id?: string | null } | null): AppRole {
  if (user?.role === 'admin') return 'admin';
  if (user?.role === 'driver') return 'driver';
  if (user?.role === 'dispatcher' || user?.transport_company_id) return 'transport';
  return 'company';
}

export default function ProfilePage() {
  const { isRTL, user } = useAuthStore();
  const { toast } = useToast();
  const [form, setForm] = useState({ name_ar: '', name_en: '', phone: '' });
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = () => {
    if (!user?.id) return;
    setLoading(true);
    setLoadError(null);
    getMyProfile(user.id)
      .then((p) => {
        if (p) setForm({ name_ar: p.name_ar ?? '', name_en: p.name_en ?? '', phone: p.phone ?? '' });
      })
      .catch((err) => {
        setLoadError(err instanceof Error ? err.message : 'Failed to load');
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  async function handleSave() {
    if (!user?.id) return;
    setSaving(true);
    try {
      await updateProfile(user.id, {
        name_ar: form.name_ar,
        name_en: form.name_en || undefined,
        phone: form.phone || undefined,
      });
      toast({ title: isRTL ? 'تم بنجاح' : 'Success', description: isRTL ? 'تم حفظ الملف الشخصي' : 'Profile saved' });
    } catch (e) {
      toast({ title: isRTL ? 'خطأ' : 'Error', description: e instanceof Error ? e.message : 'Failed', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <AppShell role={shellRole(user)}>
      <div className={`max-w-2xl space-y-8 ${isRTL ? 'rtl' : 'ltr'}`}>
        <div>
          <h1 className="text-3xl font-bold text-foreground mb-2">{isRTL ? 'الملف الشخصي والإعدادات' : 'Profile & Settings'}</h1>
          <p className="text-muted-foreground">{isRTL ? 'تحديث معلومات حسابك' : 'Update your account information'}</p>
        </div>
        <Card className="bg-card text-card-foreground border-border">
          <CardHeader>
            <CardTitle className="flex items-center gap-3"><UserIcon className="w-6 h-6 text-primary" />{isRTL ? 'المعلومات الشخصية' : 'Personal Information'}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {loading ? (
              <LoadingState label={isRTL ? 'جارٍ التحميل' : 'Loading'} />
            ) : loadError ? (
              <ErrorState message={loadError} retry={load} retryLabel={isRTL ? 'إعادة المحاولة' : 'Retry'} />
            ) : (
              <>
                <div>
                  <Label htmlFor="profile-name-ar">{isRTL ? 'الاسم (عربي)' : 'Name (Arabic)'}</Label>
                  <Input id="profile-name-ar" value={form.name_ar} onChange={(e) => setForm({ ...form, name_ar: e.target.value })} className="mt-2" />
                </div>
                <div>
                  <Label htmlFor="profile-name-en">{isRTL ? 'الاسم (إنجليزي)' : 'Name (English)'}</Label>
                  <Input id="profile-name-en" value={form.name_en} onChange={(e) => setForm({ ...form, name_en: e.target.value })} className="mt-2" />
                </div>
                <div>
                  <Label htmlFor="profile-phone">{isRTL ? 'رقم الهاتف' : 'Phone'}</Label>
                  <Input id="profile-phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="mt-2" dir="ltr" />
                </div>
                <Button onClick={handleSave} disabled={saving} aria-busy={saving} className="bg-primary text-primary-foreground">
                  {isRTL ? 'حفظ التغييرات' : 'Save Changes'}
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
