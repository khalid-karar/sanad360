import { useEffect, useState } from 'react';
import { useAuthStore } from '../stores/authStore';
import { useTransportStore } from '../stores/transportStore';
import { licenseStatus } from '../lib/api/drivers';
import { inviteDriver } from '../lib/api/invites';
import type { Driver } from '../lib/database.types';
import AppShell from '../components/AppShell';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useToast } from '@/hooks/use-toast';
import { PlusIcon, SearchIcon, UserIcon, CalendarIcon, ShieldCheckIcon, AlertTriangleIcon, PowerIcon, KeyRoundIcon, FileCheckIcon } from 'lucide-react';
import FadeInUp from '../components/animations/FadeInUp';
import { Modal } from '@/components/ui/modal';
import DocumentChecklist from '../components/documents/DocumentChecklist';
import { LoadingState, EmptyState } from '@/components/ui/states';

export default function DriverManagementPage() {
  const { isRTL, user } = useAuthStore();
  const { drivers, isLoadingDrivers, loadDrivers, addDriver, editDriver } = useTransportStore();
  const [docsFor, setDocsFor] = useState<Driver | null>(null);
  // drivers_insert RLS allows owner/manager/dispatcher — mirror it explicitly
  // (was previously ungated, which happened to match today's route roles but
  // wasn't self-documenting, unlike VehicleManagementPage's canManage).
  const canAdd = ['owner', 'manager', 'dispatcher'].includes(user?.role ?? '');
  // drivers_update (used by Deactivate) is owner/manager only — hiding it for
  // dispatcher avoids a raw 42501 permission-denied error (mirrors VehicleManagementPage).
  const canDeactivate = ['owner', 'manager'].includes(user?.role ?? '');
  const { toast } = useToast();
  const [searchTerm, setSearchTerm] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ name_ar: '', license_number: '', license_expiry: '', absher_verified: false });

  // Invite flow: turn a fleet record into a sign-in-able driver account
  const [inviting, setInviting] = useState<Driver | null>(null);
  const [invitePhone, setInvitePhone] = useState('');
  const [invitePassword, setInvitePassword] = useState('');
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteEmail, setInviteEmail] = useState<string | null>(null);

  useEffect(() => {
    if (user?.transport_company_id) loadDrivers(user.transport_company_id);
  }, [loadDrivers, user?.transport_company_id]);

  const filtered = drivers.filter((d) =>
    d.name_ar.toLowerCase().includes(searchTerm.toLowerCase()) ||
    d.license_number.toLowerCase().includes(searchTerm.toLowerCase())
  );

  async function handleAdd() {
    if (!form.name_ar || !form.license_number || !form.license_expiry) {
      toast({ title: isRTL ? 'خطأ' : 'Error', description: isRTL ? 'يرجى ملء جميع الحقول' : 'Please fill all fields', variant: 'destructive' });
      return;
    }
    if (!user?.transport_company_id) {
      toast({ title: isRTL ? 'خطأ' : 'Error', description: isRTL ? 'لا توجد شركة نقل مرتبطة' : 'No transport company linked', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      await addDriver({
        transport_company_id: user.transport_company_id,
        profile_id: null,
        phone: null,
        name_ar: form.name_ar,
        license_number: form.license_number,
        license_expiry: form.license_expiry,
        absher_verified: form.absher_verified,
        status: 'active',
      });
      setForm({ name_ar: '', license_number: '', license_expiry: '', absher_verified: false });
      setShowAddForm(false);
      toast({ title: isRTL ? 'تم بنجاح' : 'Success', description: isRTL ? 'تم إضافة السائق' : 'Driver added' });
    } catch (e) {
      toast({ title: isRTL ? 'خطأ' : 'Error', description: e instanceof Error ? e.message : 'Failed', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  }

  function openInvite(d: Driver) {
    setInviting(d);
    setInvitePhone('');
    setInvitePassword('');
    setInviteEmail(null);
  }

  async function handleInvite() {
    if (!inviting) return;
    if (!invitePhone.trim() || invitePassword.length < 10) {
      toast({
        title: isRTL ? 'خطأ' : 'Error',
        description: isRTL
          ? 'أدخل رقم الجوال وكلمة مرور مؤقتة (10 أحرف على الأقل)'
          : 'Enter the phone number and a temp password (min 10 characters)',
        variant: 'destructive',
      });
      return;
    }
    setInviteBusy(true);
    try {
      const result = await inviteDriver(inviting.id, invitePhone.trim(), invitePassword);
      setInviteEmail(result.email);
      if (user?.transport_company_id) await loadDrivers(user.transport_company_id);
      toast({ title: isRTL ? 'تم بنجاح' : 'Success', description: isRTL ? 'تم إنشاء حساب السائق' : 'Driver account created' });
    } catch (e) {
      toast({ title: isRTL ? 'خطأ' : 'Error', description: e instanceof Error ? e.message : 'Failed', variant: 'destructive' });
    } finally {
      setInviteBusy(false);
    }
  }

  async function handleToggleStatus(d: Driver) {
    const wasActive = d.status === 'active';
    try {
      await editDriver(d.id, { status: wasActive ? 'inactive' : 'active' });
      toast({
        title: isRTL ? 'تم' : 'Done',
        description: wasActive
          ? (isRTL ? 'تم تعطيل السائق' : 'Driver deactivated')
          : (isRTL ? 'تم إعادة تفعيل السائق' : 'Driver reactivated'),
      });
    } catch (e) {
      toast({ title: isRTL ? 'خطأ' : 'Error', description: e instanceof Error ? e.message : 'Failed', variant: 'destructive' });
    }
  }

  function badge(expiry: string) {
    const st = licenseStatus(expiry, 30);
    if (st === 'expired') return <Badge variant="destructive">{isRTL ? 'منتهية' : 'Expired'}</Badge>;
    if (st === 'expiring') return <Badge className="bg-warning text-warning-foreground">{isRTL ? 'تنتهي قريباً' : 'Expiring'}</Badge>;
    return <Badge variant="default">{isRTL ? 'صالحة' : 'Valid'}</Badge>;
  }

  return (
    <AppShell role="transport">
      <div className={`space-y-8 ${isRTL ? 'rtl' : 'ltr'}`}>
        <FadeInUp>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h1 className="text-3xl font-bold text-foreground mb-2">{isRTL ? 'إدارة السائقين' : 'Driver Management'}</h1>
              <p className="text-muted-foreground">{isRTL ? 'إدارة وتتبع السائقين ورخصهم' : 'Manage and track drivers and their licenses'}</p>
            </div>
            {canAdd && (
              <Button onClick={() => setShowAddForm(true)} className="bg-primary text-primary-foreground hover:bg-primary/90">
                <PlusIcon className="w-4 h-4 me-2" />{isRTL ? 'إضافة سائق' : 'Add Driver'}
              </Button>
            )}
          </div>
        </FadeInUp>

        <Card className="bg-card text-card-foreground border-border">
          <CardContent className="pt-6">
            <div className="relative">
              <SearchIcon className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" aria-hidden="true" />
              <Input
                type="text"
                aria-label={isRTL ? 'البحث عن سائق' : 'Search drivers'}
                placeholder={isRTL ? 'البحث عن سائق...' : 'Search drivers...'}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="ps-10"
              />
            </div>
          </CardContent>
        </Card>

        {canAdd && showAddForm && (
          <Card className="bg-card text-card-foreground border-2 border-primary/20">
            <CardHeader>
              <CardTitle className="flex items-center gap-3"><UserIcon className="w-6 h-6 text-primary" />{isRTL ? 'إضافة سائق جديد' : 'Add New Driver'}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="driver-name">{isRTL ? 'اسم السائق' : 'Driver Name'}</Label>
                  <Input id="driver-name" value={form.name_ar} onChange={(e) => setForm({ ...form, name_ar: e.target.value })} className="mt-2" />
                </div>
                <div>
                  <Label htmlFor="driver-license-number">{isRTL ? 'رقم الرخصة' : 'License Number'}</Label>
                  <Input id="driver-license-number" value={form.license_number} onChange={(e) => setForm({ ...form, license_number: e.target.value })} className="mt-2" />
                </div>
                <div>
                  <Label htmlFor="driver-license-expiry">{isRTL ? 'تاريخ انتهاء الرخصة' : 'License Expiry'}</Label>
                  <Input id="driver-license-expiry" type="date" value={form.license_expiry} onChange={(e) => setForm({ ...form, license_expiry: e.target.value })} className="mt-2" dir="ltr" />
                </div>
                <div className="flex items-center gap-2 pt-8">
                  <input type="checkbox" id="absher" checked={form.absher_verified} onChange={(e) => setForm({ ...form, absher_verified: e.target.checked })} />
                  <Label htmlFor="absher">{isRTL ? 'تم التحقق من أبشر' : 'Absher Verified'}</Label>
                </div>
              </div>
              <div className="flex gap-3 pt-4">
                <Button variant="outline" onClick={() => setShowAddForm(false)} className="flex-1">{isRTL ? 'إلغاء' : 'Cancel'}</Button>
                <Button onClick={handleAdd} disabled={saving} className="flex-1 bg-primary text-primary-foreground">{isRTL ? 'إضافة السائق' : 'Add Driver'}</Button>
              </div>
            </CardContent>
          </Card>
        )}

        <Card className="bg-card text-card-foreground border-border">
          <CardHeader>
            <CardTitle>{isRTL ? 'قائمة السائقين' : 'Drivers List'} ({filtered.length})</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoadingDrivers ? (
              <LoadingState label={isRTL ? 'جارٍ التحميل' : 'Loading'} />
            ) : (
            <ScrollArea className="h-[600px] pe-4" role="region" aria-label={isRTL ? 'قائمة السائقين' : 'Drivers List'}>
              <div className="space-y-4">
                {filtered.map((d) => (
                  <Card key={d.id} className={`border-2 ${d.status !== 'active' ? 'opacity-60 border-border' : 'border-border'}`}>
                    <CardContent className="pt-6">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div className="flex items-center gap-4">
                          <div className="w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center flex-shrink-0"><UserIcon className="w-6 h-6 text-primary" /></div>
                          <div>
                            <h3 className="font-semibold text-foreground text-lg">{d.name_ar}</h3>
                            <p className="text-sm text-muted-foreground">{d.license_number}</p>
                          </div>
                        </div>
                        <div className="flex items-center flex-wrap gap-3">
                          {badge(d.license_expiry)}
                          <Button size="sm" variant="outline" onClick={() => setDocsFor(d)} title={isRTL ? 'المستندات' : 'Documents'}>
                            <FileCheckIcon className="w-4 h-4 me-1" />{isRTL ? 'المستندات' : 'Documents'}
                          </Button>
                          {!d.profile_id && d.status === 'active' && (
                            <Button size="sm" variant="outline" onClick={() => openInvite(d)} title={isRTL ? 'إنشاء حساب دخول' : 'Create login account'}>
                              <KeyRoundIcon className="w-4 h-4 me-1" />{isRTL ? 'دعوة' : 'Invite'}
                            </Button>
                          )}
                          {canDeactivate && (
                            <Button
                              size="sm"
                              variant="outline"
                              className={d.status === 'active' ? 'text-destructive' : 'text-success'}
                              onClick={() => handleToggleStatus(d)}
                              title={d.status === 'active' ? (isRTL ? 'تعطيل' : 'Deactivate') : (isRTL ? 'إعادة تفعيل' : 'Reactivate')}
                              aria-label={d.status === 'active' ? (isRTL ? 'تعطيل السائق' : 'Deactivate driver') : (isRTL ? 'إعادة تفعيل السائق' : 'Reactivate driver')}
                            >
                              <PowerIcon className="w-4 h-4" />
                            </Button>
                          )}
                        </div>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4 pt-4 border-t border-border text-sm">
                        <div className="flex items-center gap-2"><CalendarIcon className="w-4 h-4 text-muted-foreground" />{d.license_expiry}</div>
                        <div className="flex items-center gap-2"><ShieldCheckIcon className={`w-4 h-4 ${d.absher_verified ? 'text-success' : 'text-muted-foreground'}`} />{d.absher_verified ? (isRTL ? 'محقق أبشر' : 'Absher Verified') : (isRTL ? 'غير محقق' : 'Not Verified')}</div>
                        <div className="flex items-center gap-2"><div className={`w-2 h-2 rounded-full ${d.status === 'active' ? 'bg-success' : 'bg-muted-foreground'}`} />{d.status === 'active' ? (isRTL ? 'نشط' : 'Active') : (isRTL ? 'غير نشط' : 'Inactive')}</div>
                      </div>
                      {licenseStatus(d.license_expiry, 30) !== 'ok' && d.status === 'active' && (
                        <div className="mt-4 p-3 bg-warning/10 border border-warning/20 rounded-lg flex items-center gap-3">
                          <AlertTriangleIcon className="w-5 h-5 text-warning flex-shrink-0" />
                          <p className="text-sm text-warning">{isRTL ? 'رخصة السائق تحتاج إلى تجديد' : 'Driver license needs renewal'}</p>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ))}
                {filtered.length === 0 && (
                  <EmptyState
                    icon={<UserIcon />}
                    title={isRTL ? 'لا يوجد سائقون' : 'No drivers'}
                    hint={searchTerm
                      ? (isRTL ? 'جرّب كلمة بحث مختلفة' : 'Try a different search term')
                      : (canAdd ? (isRTL ? 'أضف سائقاً جديداً باستخدام الزر أعلاه' : 'Add a new driver using the button above') : undefined)}
                  />
                )}
              </div>
            </ScrollArea>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Invite modal: phone → synthetic login email + temp password */}
      {inviting && (
        <Modal
          open
          onClose={() => setInviting(null)}
          isRTL={isRTL}
          title={
            <span className="flex items-center gap-2">
              <KeyRoundIcon className="w-5 h-5 text-primary" />
              {isRTL ? `دعوة ${inviting.name_ar}` : `Invite ${inviting.name_ar}`}
            </span>
          }
        >
          <div className="space-y-4">
              {inviteEmail ? (
                <div className="space-y-4">
                  <div className="p-3 rounded-md bg-success/10 border border-success/20 text-sm">
                    <p className="text-success font-medium">
                      {isRTL ? 'تم إنشاء الحساب — سلّم بيانات الدخول للسائق:' : 'Account created — hand these credentials to the driver:'}
                    </p>
                    <p className="mt-2 font-mono text-foreground" dir="ltr">{inviteEmail}</p>
                    <p className="font-mono text-foreground" dir="ltr">{invitePassword}</p>
                  </div>
                  <Button className="w-full" onClick={() => setInviting(null)}>
                    {isRTL ? 'إغلاق' : 'Close'}
                  </Button>
                </div>
              ) : (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="invite-phone">{isRTL ? 'رقم جوال السائق' : 'Driver Mobile Number'}</Label>
                    <Input
                      id="invite-phone"
                      value={invitePhone}
                      onChange={(e) => setInvitePhone(e.target.value)}
                      placeholder="05xxxxxxxx"
                      dir="ltr"
                      className="bg-background text-foreground border-input"
                    />
                    <p className="text-xs text-muted-foreground" dir="ltr">
                      {isRTL ? 'الدخول عبر' : 'Login as'} {invitePhone.replace(/\D/g, '') || '05xxxxxxxx'}@driver.sanad360.com
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="invite-password">{isRTL ? 'كلمة مرور مؤقتة (10+ أحرف)' : 'Temp Password (10+ chars)'}</Label>
                    <Input
                      id="invite-password"
                      value={invitePassword}
                      onChange={(e) => setInvitePassword(e.target.value)}
                      dir="ltr"
                      className="bg-background text-foreground border-input"
                    />
                  </div>
                  <div className="flex gap-3">
                    <Button onClick={handleInvite} disabled={inviteBusy} className="flex-1 bg-primary text-primary-foreground">
                      {isRTL ? 'إنشاء الحساب' : 'Create Account'}
                    </Button>
                    <Button variant="outline" onClick={() => setInviting(null)} className="flex-1">
                      {isRTL ? 'إلغاء' : 'Cancel'}
                    </Button>
                  </div>
                </>
              )}
          </div>
        </Modal>
      )}

      {docsFor && (
        <Modal
          open
          onClose={() => setDocsFor(null)}
          isRTL={isRTL}
          title={isRTL ? `مستندات ${docsFor.name_ar}` : `${docsFor.name_ar}'s Documents`}
        >
          <div className="space-y-4">
            <DocumentChecklist ownerType="driver" ownerId={docsFor.id} isRTL={isRTL} />
            <Button variant="outline" className="w-full" onClick={() => setDocsFor(null)}>
              {isRTL ? 'إغلاق' : 'Close'}
            </Button>
          </div>
        </Modal>
      )}
    </AppShell>
  );
}
