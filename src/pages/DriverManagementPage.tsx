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
import { PlusIcon, SearchIcon, UserIcon, CalendarIcon, ShieldCheckIcon, AlertTriangleIcon, PowerIcon, KeyRoundIcon } from 'lucide-react';
import FadeInUp from '../components/animations/FadeInUp';
import { Modal } from '@/components/ui/modal';

export default function DriverManagementPage() {
  const { isRTL, user } = useAuthStore();
  const { drivers, loadDrivers, addDriver, removeDriver } = useTransportStore();
  // drivers_insert RLS allows owner/manager/dispatcher, but drivers_update
  // (used by Deactivate) is owner/manager only — hiding it for dispatcher
  // avoids a raw 42501 permission-denied error (mirrors VehicleManagementPage).
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

  async function handleDeactivate(id: string) {
    try {
      await removeDriver(id);
      toast({ title: isRTL ? 'تم' : 'Done', description: isRTL ? 'تم تعطيل السائق' : 'Driver deactivated' });
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
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-foreground mb-2">{isRTL ? 'إدارة السائقين' : 'Driver Management'}</h1>
              <p className="text-muted-foreground">{isRTL ? 'إدارة وتتبع السائقين ورخصهم' : 'Manage and track drivers and their licenses'}</p>
            </div>
            <Button onClick={() => setShowAddForm(true)} className="bg-primary text-primary-foreground hover:bg-primary/90">
              <PlusIcon className="w-4 h-4 me-2" />{isRTL ? 'إضافة سائق' : 'Add Driver'}
            </Button>
          </div>
        </FadeInUp>

        <Card className="bg-card text-card-foreground border-border">
          <CardContent className="pt-6">
            <div className="relative">
              <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input type="text" placeholder={isRTL ? 'البحث عن سائق...' : 'Search drivers...'} value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="pl-10" />
            </div>
          </CardContent>
        </Card>

        {showAddForm && (
          <Card className="bg-card text-card-foreground border-2 border-primary/20">
            <CardHeader>
              <CardTitle className="flex items-center gap-3"><UserIcon className="w-6 h-6 text-primary" />{isRTL ? 'إضافة سائق جديد' : 'Add New Driver'}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label>{isRTL ? 'اسم السائق' : 'Driver Name'}</Label>
                  <Input value={form.name_ar} onChange={(e) => setForm({ ...form, name_ar: e.target.value })} className="mt-2" />
                </div>
                <div>
                  <Label>{isRTL ? 'رقم الرخصة' : 'License Number'}</Label>
                  <Input value={form.license_number} onChange={(e) => setForm({ ...form, license_number: e.target.value })} className="mt-2" />
                </div>
                <div>
                  <Label>{isRTL ? 'تاريخ انتهاء الرخصة' : 'License Expiry'}</Label>
                  <Input type="date" value={form.license_expiry} onChange={(e) => setForm({ ...form, license_expiry: e.target.value })} className="mt-2" dir="ltr" />
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
            <ScrollArea className="h-[600px] pr-4">
              <div className="space-y-4">
                {filtered.map((d) => (
                  <Card key={d.id} className={`border-2 ${d.status !== 'active' ? 'opacity-60 border-border' : 'border-border'}`}>
                    <CardContent className="pt-6">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-4">
                          <div className="w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center"><UserIcon className="w-6 h-6 text-primary" /></div>
                          <div>
                            <h3 className="font-semibold text-foreground text-lg">{d.name_ar}</h3>
                            <p className="text-sm text-muted-foreground">{d.license_number}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          {badge(d.license_expiry)}
                          {!d.profile_id && d.status === 'active' && (
                            <Button size="sm" variant="outline" onClick={() => openInvite(d)} title={isRTL ? 'إنشاء حساب دخول' : 'Create login account'}>
                              <KeyRoundIcon className="w-4 h-4 me-1" />{isRTL ? 'دعوة' : 'Invite'}
                            </Button>
                          )}
                          {canDeactivate && (
                            <Button size="sm" variant="outline" className="text-destructive" disabled={d.status !== 'active'} onClick={() => handleDeactivate(d.id)} title={isRTL ? 'تعطيل' : 'Deactivate'} aria-label={isRTL ? 'تعطيل السائق' : 'Deactivate driver'}>
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
                {filtered.length === 0 && <div className="text-center py-12 text-muted-foreground">{isRTL ? 'لا يوجد سائقون' : 'No drivers'}</div>}
              </div>
            </ScrollArea>
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
                    <Label>{isRTL ? 'رقم جوال السائق' : 'Driver Mobile Number'}</Label>
                    <Input
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
                    <Label>{isRTL ? 'كلمة مرور مؤقتة (10+ أحرف)' : 'Temp Password (10+ chars)'}</Label>
                    <Input
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
    </AppShell>
  );
}
