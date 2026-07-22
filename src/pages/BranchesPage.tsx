import { useEffect, useRef, useState } from 'react';
import { useAuthStore } from '../stores/authStore';
import {
  listBranches, createBranch, updateBranch, deleteBranch, requestBranchQrToken,
} from '../lib/api/branches';
import type { Branch } from '../lib/database.types';
import AppShell from '../components/AppShell';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { PlusIcon, MapPinIcon, PowerIcon, QrCodeIcon, Building2Icon, FileCheckIcon } from 'lucide-react';
import GeofenceMapPicker from '@/components/map/GeofenceMapPicker';
import { LoadingState, EmptyState, ErrorState } from '@/components/ui/states';
import { Modal } from '@/components/ui/modal';
import QRCode from 'qrcode';
import DocumentChecklist from '../components/documents/DocumentChecklist';

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

  // Rotating branch QR (migration 022/Part B): branches.qr_token is now a
  // server-only HMAC secret, never sent to any client. This device polls
  // services/pdf for a fresh, short-TTL (90s) signed token and re-renders the
  // QR image from IT — never from a stored secret — refreshing itself before
  // each token expires. A printed poster no longer makes sense (it would go
  // stale within 90s), so this modal is meant to stay open on a device left
  // at the waste point instead of being printed.
  const QR_REFRESH_MARGIN_MS = 20_000; // refetch ~20s before expiry
  const [qrBranch, setQrBranch] = useState<Branch | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [qrError, setQrError] = useState<string | null>(null);
  const [docsFor, setDocsFor] = useState<Branch | null>(null);
  const qrRefreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function clearQrRefresh() {
    if (qrRefreshTimer.current) {
      clearTimeout(qrRefreshTimer.current);
      qrRefreshTimer.current = null;
    }
  }

  async function refreshQr(branchId: string) {
    try {
      const { token, expires_at } = await requestBranchQrToken(branchId);
      const dataUrl = await QRCode.toDataURL(token, { width: 480, margin: 2 });
      setQrDataUrl(dataUrl);
      setQrError(null);

      const msUntilExpiry = new Date(expires_at).getTime() - Date.now();
      const delay = Math.max(msUntilExpiry - QR_REFRESH_MARGIN_MS, 5_000);
      qrRefreshTimer.current = setTimeout(() => refreshQr(branchId), delay);
    } catch (e) {
      setQrError(describeError(e, isRTL));
      // Still retry — a branch operator's device losing the display for a
      // full refresh cycle is a real field problem, so back off briefly
      // instead of giving up.
      qrRefreshTimer.current = setTimeout(() => refreshQr(branchId), 5_000);
    }
  }

  function openQr(b: Branch) {
    setQrBranch(b);
    setQrDataUrl(null);
    setQrError(null);
    void refreshQr(b.id);
  }

  function closeQr() {
    clearQrRefresh();
    setQrBranch(null);
    setQrDataUrl(null);
    setQrError(null);
  }

  // A backgrounded tab can have its timers throttled by the browser, letting
  // the displayed code silently go stale while a driver waits at the point —
  // refresh immediately whenever the tab regains focus/visibility.
  useEffect(() => {
    if (!qrBranch) return;
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refreshQr(qrBranch.id);
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qrBranch?.id]);

  useEffect(() => () => clearQrRefresh(), []);

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

  async function handleToggleStatus(b: Branch) {
    try {
      if (b.status === 'active') {
        await deleteBranch(b.id);
      } else {
        await updateBranch(b.id, { status: 'active' });
      }
      await load();
      toast({
        title: isRTL ? 'تم' : 'Done',
        description: b.status === 'active'
          ? (isRTL ? 'تم تعطيل الفرع' : 'Branch deactivated')
          : (isRTL ? 'تم إعادة تفعيل الفرع' : 'Branch reactivated'),
      });
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
              ? 'أضف أول فرع وحدّد نطاقه الجغرافي، ثم اعرض رمز QR المتجدد على جهاز عند نقطة النفايات'
              : 'Add your first branch with its geofence, then display its rotating QR on a device at the waste point'}
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
                  <Button size="sm" variant="outline" onClick={() => setDocsFor(b)} title={isRTL ? 'المستندات' : 'Documents'} aria-label={isRTL ? 'مستندات الفرع' : 'Branch documents'}>
                    <FileCheckIcon className="w-4 h-4" />
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className={b.status === 'active' ? 'text-destructive' : 'text-success'}
                    onClick={() => handleToggleStatus(b)}
                    title={b.status === 'active' ? (isRTL ? 'تعطيل الفرع' : 'Deactivate branch') : (isRTL ? 'إعادة تفعيل الفرع' : 'Reactivate branch')}
                    aria-label={b.status === 'active' ? (isRTL ? 'تعطيل الفرع' : 'Deactivate branch') : (isRTL ? 'إعادة تفعيل الفرع' : 'Reactivate branch')}
                  >
                    <PowerIcon className="w-4 h-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      {/* Rotating branch QR modal — a live signed token, refreshed before each
          90s expiry (Radix Dialog: focus trap + Esc). Meant to stay open on a
          device left at the waste point, not printed — a printed code would
          go stale within 90 seconds. */}
      {qrBranch && (
        <Modal
          open
          onClose={closeQr}
          isRTL={isRTL}
          maxWidth="max-w-sm"
          title={
            <span className="flex items-center gap-2">
              <QrCodeIcon className="w-5 h-5 text-primary" />
              {isRTL ? 'رمز نقطة النفايات' : 'Waste-Point QR'}
            </span>
          }
        >
          <div className="space-y-4 text-center">
              <p className="font-semibold text-lg text-foreground">{qrBranch.name_ar}</p>
              {qrBranch.name_en && <p className="text-sm text-muted-foreground" dir="ltr">{qrBranch.name_en}</p>}
              {qrDataUrl ? (
                <img src={qrDataUrl} alt="Branch QR" className="mx-auto w-56 h-56 rounded-md border border-border bg-white p-2" />
              ) : (
                <div
                  className="mx-auto w-56 h-56 rounded-md border border-border bg-muted flex items-center justify-center text-sm text-muted-foreground"
                  role="status"
                >
                  {isRTL ? 'جارٍ التحميل...' : 'Loading...'}
                </div>
              )}
              {qrError && <p className="text-xs text-destructive" role="alert">{qrError}</p>}
              <p className="text-xs text-muted-foreground">
                {isRTL
                  ? 'اترك هذا الجهاز ظاهراً عند نقطة تسليم النفايات — الرمز يتجدد تلقائياً ويمسحه السائق'
                  : 'Keep this device visible at the waste hand-over point — the code refreshes itself; the driver scans it'}
              </p>
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
            <DocumentChecklist ownerType="branch" ownerId={docsFor.id} isRTL={isRTL} />
            <Button variant="outline" className="w-full" onClick={() => setDocsFor(null)}>
              {isRTL ? 'إغلاق' : 'Close'}
            </Button>
          </div>
        </Modal>
      )}
    </AppShell>
  );
}
