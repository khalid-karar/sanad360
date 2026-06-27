import { useEffect, useState } from 'react';
import { useAuthStore } from '../stores/authStore';
import { useTransportStore } from '../stores/transportStore';
import { licenseStatus } from '../lib/api/drivers';
import type { Vehicle } from '../lib/database.types';
import AppShell from '../components/AppShell';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { PlusIcon, SearchIcon, TruckIcon, CalendarIcon, AlertTriangleIcon, PowerIcon, FileTextIcon } from 'lucide-react';

const vehicleTypes = [
  { value: 'small_truck', labelAr: 'شاحنة صغيرة', labelEn: 'Small Truck' },
  { value: 'medium_truck', labelAr: 'شاحنة متوسطة', labelEn: 'Medium Truck' },
  { value: 'large_truck', labelAr: 'شاحنة كبيرة', labelEn: 'Large Truck' },
  { value: 'specialized', labelAr: 'مركبة متخصصة', labelEn: 'Specialized' },
] as const;

const licenseTypes = [
  { value: 'general', labelAr: 'نفايات عامة', labelEn: 'General' },
  { value: 'medical', labelAr: 'نفايات طبية', labelEn: 'Medical' },
  { value: 'hazardous', labelAr: 'نفايات خطرة', labelEn: 'Hazardous' },
  { value: 'industrial', labelAr: 'نفايات صناعية', labelEn: 'Industrial' },
  { value: 'electronic', labelAr: 'نفايات إلكترونية', labelEn: 'Electronic' },
] as const;

export default function VehicleManagementPage() {
  const { isRTL, user } = useAuthStore();
  const { vehicles, loadVehicles, addVehicle, removeVehicle } = useTransportStore();
  const { toast } = useToast();
  const [searchTerm, setSearchTerm] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    plate_number: '', type: '', waste_license_type: '', ncwm_license_expiry: '',
  });

  useEffect(() => {
    if (user?.transport_company_id) loadVehicles(user.transport_company_id);
  }, [loadVehicles, user?.transport_company_id]);

  const filtered = vehicles.filter((v) =>
    v.plate_number.toLowerCase().includes(searchTerm.toLowerCase())
  );

  async function handleAdd() {
    if (!form.plate_number || !form.type || !form.waste_license_type || !form.ncwm_license_expiry) {
      toast({ title: isRTL ? 'خطأ' : 'Error', description: isRTL ? 'يرجى ملء جميع الحقول' : 'Please fill all fields', variant: 'destructive' });
      return;
    }
    if (!user?.transport_company_id) {
      toast({ title: isRTL ? 'خطأ' : 'Error', description: isRTL ? 'لا توجد شركة نقل مرتبطة' : 'No transport company linked', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      await addVehicle({
        transport_company_id: user.transport_company_id,
        plate_number: form.plate_number,
        type: form.type as Vehicle['type'],
        waste_license_type: form.waste_license_type as Vehicle['waste_license_type'],
        ncwm_license_number: null,
        ncwm_license_expiry: form.ncwm_license_expiry,
        status: 'active',
      });
      setForm({ plate_number: '', type: '', waste_license_type: '', ncwm_license_expiry: '' });
      setShowAddForm(false);
      toast({ title: isRTL ? 'تم بنجاح' : 'Success', description: isRTL ? 'تم إضافة المركبة' : 'Vehicle added' });
    } catch (e) {
      toast({ title: isRTL ? 'خطأ' : 'Error', description: e instanceof Error ? e.message : 'Failed', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  }

  async function handleDeactivate(id: string) {
    try {
      await removeVehicle(id);
      toast({ title: isRTL ? 'تم' : 'Done', description: isRTL ? 'تم تعطيل المركبة' : 'Vehicle deactivated' });
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

  const typeLabel = (v: string) => vehicleTypes.find((t) => t.value === v)?.[isRTL ? 'labelAr' : 'labelEn'] ?? v;
  const licLabel = (v: string) => licenseTypes.find((t) => t.value === v)?.[isRTL ? 'labelAr' : 'labelEn'] ?? v;

  return (
    <AppShell role="transport">
      <div className={`space-y-8 ${isRTL ? 'rtl' : 'ltr'}`}>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-foreground mb-2">{isRTL ? 'إدارة المركبات' : 'Vehicle Management'}</h1>
            <p className="text-muted-foreground">{isRTL ? 'إدارة وتتبع المركبات وتراخيص NCWM' : 'Manage and track vehicles and NCWM licenses'}</p>
          </div>
          <Button onClick={() => setShowAddForm(true)} className="bg-primary text-primary-foreground hover:bg-primary/90">
            <PlusIcon className="w-4 h-4 mr-2" />{isRTL ? 'إضافة مركبة' : 'Add Vehicle'}
          </Button>
        </div>

        <Card className="bg-card text-card-foreground border-border">
          <CardContent className="pt-6">
            <div className="relative">
              <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input type="text" placeholder={isRTL ? 'البحث عن مركبة...' : 'Search vehicles...'} value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="pl-10" />
            </div>
          </CardContent>
        </Card>

        {showAddForm && (
          <Card className="bg-card text-card-foreground border-2 border-primary/20">
            <CardHeader>
              <CardTitle className="flex items-center gap-3"><TruckIcon className="w-6 h-6 text-primary" />{isRTL ? 'إضافة مركبة جديدة' : 'Add New Vehicle'}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label>{isRTL ? 'رقم اللوحة' : 'Plate Number'}</Label>
                  <Input value={form.plate_number} onChange={(e) => setForm({ ...form, plate_number: e.target.value })} className="mt-2" placeholder="ABC-1234" />
                </div>
                <div>
                  <Label>{isRTL ? 'نوع المركبة' : 'Vehicle Type'}</Label>
                  <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v })}>
                    <SelectTrigger className="mt-2"><SelectValue placeholder={isRTL ? 'اختر النوع' : 'Select type'} /></SelectTrigger>
                    <SelectContent>{vehicleTypes.map((t) => <SelectItem key={t.value} value={t.value}>{isRTL ? t.labelAr : t.labelEn}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>{isRTL ? 'نوع ترخيص النفايات' : 'Waste License Type'}</Label>
                  <Select value={form.waste_license_type} onValueChange={(v) => setForm({ ...form, waste_license_type: v })}>
                    <SelectTrigger className="mt-2"><SelectValue placeholder={isRTL ? 'اختر الترخيص' : 'Select license'} /></SelectTrigger>
                    <SelectContent>{licenseTypes.map((t) => <SelectItem key={t.value} value={t.value}>{isRTL ? t.labelAr : t.labelEn}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>{isRTL ? 'تاريخ انتهاء ترخيص NCWM' : 'NCWM License Expiry'}</Label>
                  <Input type="date" value={form.ncwm_license_expiry} onChange={(e) => setForm({ ...form, ncwm_license_expiry: e.target.value })} className="mt-2" dir="ltr" />
                </div>
              </div>
              <div className="flex gap-3 pt-4">
                <Button variant="outline" onClick={() => setShowAddForm(false)} className="flex-1">{isRTL ? 'إلغاء' : 'Cancel'}</Button>
                <Button onClick={handleAdd} disabled={saving} className="flex-1 bg-primary text-primary-foreground">{isRTL ? 'إضافة المركبة' : 'Add Vehicle'}</Button>
              </div>
            </CardContent>
          </Card>
        )}

        <Card className="bg-card text-card-foreground border-border">
          <CardHeader><CardTitle>{isRTL ? 'قائمة المركبات' : 'Vehicles List'} ({filtered.length})</CardTitle></CardHeader>
          <CardContent>
            <ScrollArea className="h-[600px] pr-4">
              <div className="space-y-4">
                {filtered.map((v) => (
                  <Card key={v.id} className={`border-2 ${v.status !== 'active' ? 'opacity-60 border-border' : 'border-border'}`}>
                    <CardContent className="pt-6">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-4">
                          <div className="w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center"><TruckIcon className="w-6 h-6 text-primary" /></div>
                          <div>
                            <h3 className="font-semibold text-foreground text-lg">{v.plate_number}</h3>
                            <p className="text-sm text-muted-foreground">{typeLabel(v.type)}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          {badge(v.ncwm_license_expiry)}
                          <Button size="sm" variant="outline" className="text-destructive" disabled={v.status !== 'active'} onClick={() => handleDeactivate(v.id)} title={isRTL ? 'تعطيل' : 'Deactivate'}>
                            <PowerIcon className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4 pt-4 border-t border-border text-sm">
                        <div className="flex items-center gap-2"><CalendarIcon className="w-4 h-4 text-muted-foreground" />{v.ncwm_license_expiry}</div>
                        <div className="flex items-center gap-2"><FileTextIcon className="w-4 h-4 text-muted-foreground" />{licLabel(v.waste_license_type)}</div>
                        <div className="flex items-center gap-2"><div className={`w-2 h-2 rounded-full ${v.status === 'active' ? 'bg-success' : 'bg-muted-foreground'}`} />{v.status === 'active' ? (isRTL ? 'نشطة' : 'Active') : (isRTL ? 'غير نشطة' : 'Inactive')}</div>
                      </div>
                      {licenseStatus(v.ncwm_license_expiry, 30) !== 'ok' && v.status === 'active' && (
                        <div className="mt-4 p-3 bg-warning/10 border border-warning/20 rounded-lg flex items-center gap-3">
                          <AlertTriangleIcon className="w-5 h-5 text-warning flex-shrink-0" />
                          <p className="text-sm text-warning">{isRTL ? 'ترخيص NCWM يحتاج إلى تجديد' : 'NCWM license needs renewal'}</p>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ))}
                {filtered.length === 0 && <div className="text-center py-12 text-muted-foreground">{isRTL ? 'لا توجد مركبات' : 'No vehicles'}</div>}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
