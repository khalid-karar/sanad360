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
import { PlusIcon, MapPinIcon, PowerIcon, QrCodeIcon, PrinterIcon, Building2Icon } from 'lucide-react';
import GeofenceMapPicker from '@/components/map/GeofenceMapPicker';
import { LoadingState, EmptyState, ErrorState } from '@/components/ui/states';
import { Modal } from '@/components/ui/modal';
import QRCode from 'qrcode';

const EMPTY = { name_ar: '', name_en: '', city: '', geofence_lat: '', geofence_lng: '', geofence_radius_m: '150' };

/** Map raw Supabase/Postgres errors to a friendly bilingual message. */
function describeError(e: unknown, isRTL: boolean): string {
  const msg = e instanceof Error ? e.message : String(e ?? '');
  const code = (e as { code?: string } | null)?.code;
  // 42501 = permission denied; RLS violations mention "row-level security"
  if (code === '42501' || /permission denied|row-level security|not authorized/i.test(msg)) {
    return isRTL ? 'غير مصرح' : 'Not authorized';
  }
  return msg || (isRTL ? 'فشل' : 'Failed');
}

export default function BranchesPage() {
  const { isRTL, user } = useAuthStore();
  const { toast } = useToast();
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Branch | null>(null);
  const [form, setForm] = useState({ ...EMPTY });
  const [saving, setSaving] = useState(false);

  // QR board: the branch qr_token rendered as a scannable, printable code.
  // Drivers scan it at the waste point; the server verifies the value against
  // branches.qr_token (migration 013) — so this board is what makes the QR
  // check real in the field.
  const [qrBranch, setQrBranch] = useState<Branch | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);

  async function openQr(b: Branch) {
    try {
      const dataUrl = await QRCode.toDataURL(b.qr_token, { width: 480, margin: 2 });
      setQrDataUrl(dataUrl);
      setQrBranch(b);
    } catch {
      toast({ title: isRTL ? 'خطأ' : 'Error', description: isRTL ? 'تعذر إنشاء الرمز' : 'Could not generate QR', variant: 'destructive' });
    }
  }

  function printQr() {
    if (!qrBranch || !qrDataUrl) return;
    const w = window.open('', '_blank', 'width=800,height=1000');
    if (!w) return;
    w.document.write(`<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="UTF-8">
  <title>${qrBranch.name_ar} — رمز نقطة النفايات</title>
  <style>
    @page { size: A4; margin: 20mm; }
    body { font-family: 'Segoe UI', Tahoma, sans-serif; text-align: center; color: #111; margin: 0; }
    .brand { font-size: 20pt; font-weight: 700; margin-top: 10mm; }
    .brand span { color: #16a34a; }
    h1 { font-size: 26pt; margin: 8mm 0 2mm; }
    .en { font-size: 13pt; color: #555; margin: 0 0 8mm; direction: ltr; }
    img { width: 120mm; height: 120mm; }
    .hint { font-size: 14pt; margin-top: 8mm; }
    .hint-en { font-size: 11pt; color: #555; direction: ltr; }
    .footer { position: fixed; bottom: 10mm; left: 0; right: 0; font-size: 9pt; color: #888; }
  </style>
</head>
<body>
  <div class="brand">سند <span>360</span></div>
  <h1>${qrBranch.name_ar}</h1>
  ${qrBranch.name_en ? `<p class="en">${qrBranch.name_en}</p>` : ''}
  <img src="${qrDataUrl}" alt="QR">
  <p class="hint">يُثبَّت هذا الرمز عند نقطة تسليم النفايات — يمسحه السائق لتأكيد الموقع</p>
  <p class="hint-en">Post this code at the waste hand-over point — the driver scans it to confirm the location</p>
  <div class="footer">سند 360 — رمز فرع يُتحقق منه خادمياً</div>
  <script>window.onload = () => { window.print(); };</script>
</body>
</html>`);
    w.document.close();
  }

  async function load() {
    if (!user?.company_id) return;
    setLoading(true);
    setLoadError(null);
    try {
      setBranches(await listBranches(user.company_id));
    } catch (e) {
      setBranches([]);
      setLoadError(describeError(e, isRTL));
    } finally {
      setLoading(false);
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
      toast({ title: isRTL ? 'خطأ' : 'Error', description: describeError(e, isRTL), variant: 'destructive' });
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
      toast({ title: isRTL ? 'خطأ' : 'Error', description: describeError(e, isRTL), variant: 'destructive' });
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
            <PlusIcon className="w-4 h-4 me-2" />{isRTL ? 'إضافة فرع' : 'Add Branch'}
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
              </div>

              <div>
                <Label className="flex items-center gap-2 mb-2">
                  <MapPinIcon className="w-4 h-4 text-primary" />
                  {isRTL ? 'الموقع والنطاق الجغرافي' : 'Location & Geofence'}
                </Label>
                <GeofenceMapPicker
                  lat={form.geofence_lat ? Number(form.geofence_lat) : null}
                  lng={form.geofence_lng ? Number(form.geofence_lng) : null}
                  radiusM={form.geofence_radius_m ? Number(form.geofence_radius_m) : 150}
                  isRTL={isRTL}
                  onChange={(lat, lng, radiusM) =>
                    setForm((f) => ({
                      ...f,
                      geofence_lat: String(lat),
                      geofence_lng: String(lng),
                      geofence_radius_m: String(radiusM),
                    }))
                  }
                />
              </div>
              <div className="flex gap-3 pt-4">
                <Button variant="outline" onClick={() => setShowForm(false)} className="flex-1">{isRTL ? 'إلغاء' : 'Cancel'}</Button>
                <Button onClick={handleSave} disabled={saving} className="flex-1 bg-primary text-primary-foreground">{isRTL ? 'حفظ' : 'Save'}</Button>
              </div>
            </CardContent>
          </Card>
        )}

        {loading && <LoadingState label={isRTL ? 'جارٍ التحميل' : 'Loading'} />}
        {!loading && loadError && (
          <ErrorState message={loadError} retry={load} retryLabel={isRTL ? 'إعادة المحاولة' : 'Retry'} />
        )}
        {!loading && !loadError && branches.length === 0 && !showForm && (
          <EmptyState
            icon={<Building2Icon />}
            title={isRTL ? 'لا توجد فروع بعد' : 'No branches yet'}
            hint={isRTL
              ? 'أضف أول فرع وحدّد نطاقه الجغرافي، ثم اطبع رمز QR وثبّته عند نقطة النفايات'
              : 'Add your first branch with its geofence, then print its QR board and post it at the waste point'}
            action={{ label: isRTL ? 'إضافة فرع' : 'Add Branch', onClick: openCreate }}
          />
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
                  <Button size="sm" variant="outline" onClick={() => openQr(b)} title={isRTL ? 'رمز QR للفرع' : 'Branch QR board'} aria-label={isRTL ? 'رمز QR للفرع' : 'Branch QR board'}>
                    <QrCodeIcon className="w-4 h-4" />
                  </Button>
                  <Button size="sm" variant="outline" className="text-destructive" disabled={b.status !== 'active'} onClick={() => handleDeactivate(b)} aria-label={isRTL ? 'تعطيل الفرع' : 'Deactivate branch'}>
                    <PowerIcon className="w-4 h-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      {/* Branch QR board modal — preview + print (Radix Dialog: focus trap + Esc) */}
      {qrBranch && qrDataUrl && (
        <Modal
          open
          onClose={() => setQrBranch(null)}
          isRTL={isRTL}
          maxWidth="max-w-sm"
          title={
            <span className="flex items-center gap-2">
              <QrCodeIcon className="w-5 h-5 text-primary" />
              {isRTL ? 'رمز نقطة النفايات' : 'Waste-Point QR Board'}
            </span>
          }
        >
          <div className="space-y-4 text-center">
              <p className="font-semibold text-lg text-foreground">{qrBranch.name_ar}</p>
              {qrBranch.name_en && <p className="text-sm text-muted-foreground" dir="ltr">{qrBranch.name_en}</p>}
              <img src={qrDataUrl} alt="Branch QR" className="mx-auto w-56 h-56 rounded-md border border-border bg-white p-2" />
              <p className="text-xs text-muted-foreground">
                {isRTL
                  ? 'اطبع هذا الرمز وثبّته عند نقطة تسليم النفايات — يمسحه السائق ويتحقق منه الخادم'
                  : 'Print and post at the waste hand-over point — the driver scans it and the server verifies it'}
              </p>
              <Button onClick={printQr} className="w-full bg-primary text-primary-foreground">
                <PrinterIcon className="w-4 h-4 me-2" />{isRTL ? 'طباعة' : 'Print'}
              </Button>
          </div>
        </Modal>
      )}
    </AppShell>
  );
}
