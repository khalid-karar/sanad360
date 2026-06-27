import { useEffect, useState } from 'react';
import { useAuthStore } from '../stores/authStore';
import {
  listBranches, createBranch, updateBranch, deleteBranch,
} from '../lib/api/branches';
import type { Branch } from '../lib/database.types';
import AppShell from '../components/AppShell';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { PlusIcon, MapPinIcon, PowerIcon } from 'lucide-react';

const EMPTY = { name_ar: '', name_en: '', city: '', geofence_lat: '', geofence_lng: '', geofence_radius_m: '150' };

export default function BranchesPage() {
  const { isRTL, user } = useAuthStore();
  const { toast } = useToast();
  const [branches, setBranches] = useState<Branch[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Branch | null>(null);
  const [form, setForm] = useState({ ...EMPTY });
  const [saving, setSaving] = useState(false);

  async function load() {
    if (!user?.company_id) return;
    try {
      setBranches(await listBranches(user.company_id));
    } catch {
      setBranches([]);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.company_id]);

  function openCreate() {
    setEditing(null);
    setForm({ ...EMPTY });
    setShowForm(true);
  }

  function openEdit(b: Branch) {
    setEditing(b);
    setForm({
      name_ar: b.name_ar,
      name_en: b.name_en ?? '',
      city: b.city ?? '',
      geofence_lat: b.geofence_lat?.toString() ?? '',
      geofence_lng: b.geofence_lng?.toString() ?? '',
      geofence_radius_m: b.geofence_radius_m.toString(),
    });
    setShowForm(true);
  }

  async function handleSave() {
    if (!form.name_ar) {
      toast({ title: isRTL ? 'خطأ' : 'Error', description: isRTL ? 'الاسم بالعربية مطلوب' : 'Arabic name required', variant: 'destructive' });
      return;
    }
    if (!user?.company_id) return;
    setSaving(true);
    try {
      const fields = {
        name_ar: form.name_ar,
        name_en: form.name_en || undefined,
        city: form.city || undefined,
        geofence_lat: form.geofence_lat ? Number(form.geofence_lat) : undefined,
        geofence_lng: form.geofence_lng ? Number(form.geofence_lng) : undefined,
        geofence_radius_m: form.geofence_radius_m ? Number(form.geofence_radius_m) : 150,
      };
      if (editing) {
        await updateBranch(editing.id, fields);
      } else {
        await createBranch({ company_id: user.company_id, ...fields });
      }
      setShowForm(false);
      await load();
      toast({ title: isRTL ? 'تم بنجاح' : 'Success', description: isRTL ? 'تم حفظ الفرع' : 'Branch saved' });
    } catch (e) {
      toast({ title: isRTL ? 'خطأ' : 'Error', description: e instanceof Error ? e.message : 'Failed', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  }

  async function handleDeactivate(b: Branch) {
    try {
      await deleteBranch(b.id);
      await load();
      toast({ title: isRTL ? 'تم' : 'Done', description: isRTL ? 'تم تعطيل الفرع' : 'Branch deactivated' });
    } catch (e) {
      toast({ title: isRTL ? 'خطأ' : 'Error', description: e instanceof Error ? e.message : 'Failed', variant: 'destructive' });
    }
  }

  return (
    <AppShell role="company">
      <div className={`space-y-8 ${isRTL ? 'rtl' : 'ltr'}`}>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-foreground mb-2">{isRTL ? 'إدارة الفروع' : 'Branch Management'}</h1>
            <p className="text-muted-foreground">{isRTL ? 'إدارة الفروع والنطاقات الجغرافية' : 'Manage branches and geofences'}</p>
          </div>
          <Button onClick={openCreate} className="bg-primary text-primary-foreground hover:bg-primary/90">
            <PlusIcon className="w-4 h-4 mr-2" />{isRTL ? 'إضافة فرع' : 'Add Branch'}
          </Button>
        </div>

        {showForm && (
          <Card className="bg-card text-card-foreground border-2 border-primary/20">
            <CardHeader>
              <CardTitle className="flex items-center gap-3">
                <MapPinIcon className="w-6 h-6 text-primary" />
                {editing ? (isRTL ? 'تعديل الفرع' : 'Edit Branch') : (isRTL ? 'فرع جديد' : 'New Branch')}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label>{isRTL ? 'الاسم (عربي)' : 'Name (Arabic)'}</Label>
                  <Input value={form.name_ar} onChange={(e) => setForm({ ...form, name_ar: e.target.value })} className="mt-2" />
                </div>
                <div>
                  <Label>{isRTL ? 'الاسم (إنجليزي)' : 'Name (English)'}</Label>
                  <Input value={form.name_en} onChange={(e) => setForm({ ...form, name_en: e.target.value })} className="mt-2" />
                </div>
                <div>
                  <Label>{isRTL ? 'المدينة' : 'City'}</Label>
                  <Input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} className="mt-2" />
                </div>
                <div>
                  <Label>{isRTL ? 'نصف قطر النطاق (متر)' : 'Geofence Radius (m)'}</Label>
                  <Input type="number" value={form.geofence_radius_m} onChange={(e) => setForm({ ...form, geofence_radius_m: e.target.value })} className="mt-2" dir="ltr" />
                </div>
                <div>
                  <Label>{isRTL ? 'خط العرض' : 'Latitude'}</Label>
                  <Input type="number" step="any" value={form.geofence_lat} onChange={(e) => setForm({ ...form, geofence_lat: e.target.value })} className="mt-2" dir="ltr" />
                </div>
                <div>
                  <Label>{isRTL ? 'خط الطول' : 'Longitude'}</Label>
                  <Input type="number" step="any" value={form.geofence_lng} onChange={(e) => setForm({ ...form, geofence_lng: e.target.value })} className="mt-2" dir="ltr" />
                </div>
              </div>
              <div className="flex gap-3 pt-4">
                <Button variant="outline" onClick={() => setShowForm(false)} className="flex-1">{isRTL ? 'إلغاء' : 'Cancel'}</Button>
                <Button onClick={handleSave} disabled={saving} className="flex-1 bg-primary text-primary-foreground">{isRTL ? 'حفظ' : 'Save'}</Button>
              </div>
            </CardContent>
          </Card>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {branches.map((b) => (
            <Card key={b.id} className={`border-2 ${b.status !== 'active' ? 'opacity-60 border-border' : 'border-border'}`}>
              <CardContent className="pt-6">
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="font-semibold text-foreground text-lg">{isRTL ? b.name_ar : (b.name_en ?? b.name_ar)}</h3>
                    <p className="text-sm text-muted-foreground">{b.city ?? '—'}</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {b.geofence_lat && b.geofence_lng
                        ? `${b.geofence_lat}, ${b.geofence_lng} · ${b.geofence_radius_m}m`
                        : (isRTL ? 'لا يوجد نطاق جغرافي' : 'No geofence set')}
                    </p>
                  </div>
                  <Badge variant={b.status === 'active' ? 'default' : 'secondary'}>
                    {b.status === 'active' ? (isRTL ? 'نشط' : 'Active') : (isRTL ? 'غير نشط' : 'Inactive')}
                  </Badge>
                </div>
                <div className="flex gap-2 mt-4">
                  <Button size="sm" variant="outline" className="flex-1" onClick={() => openEdit(b)}>{isRTL ? 'تعديل' : 'Edit'}</Button>
                  <Button size="sm" variant="outline" className="text-destructive" disabled={b.status !== 'active'} onClick={() => handleDeactivate(b)}>
                    <PowerIcon className="w-4 h-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
          {branches.length === 0 && <div className="text-center py-12 text-muted-foreground col-span-2">{isRTL ? 'لا توجد فروع' : 'No branches'}</div>}
        </div>
      </div>
    </AppShell>
  );
}
