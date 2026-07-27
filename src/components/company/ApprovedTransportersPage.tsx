import { useCallback, useEffect, useState } from 'react';
import { useAuthStore } from '../../stores/authStore';
import AppShell from '../AppShell';
import {
  listForCompany,
  listAllTransportCompanies,
  addLink,
  deactivateLink,
  type CompanyTransporterLink,
} from '../../lib/api/companyTransporters';
import type { TransportCompany } from '../../lib/database.types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { LoadingState, EmptyState, ErrorState } from '@/components/ui/states';
import { Modal } from '@/components/ui/modal';
import { Loader2Icon, PlusIcon, TruckIcon } from 'lucide-react';

export default function ApprovedTransportersPage() {
  const { isRTL, user } = useAuthStore();
  const { toast } = useToast();
  const companyId = user?.company_id ?? undefined;

  const [links, setLinks] = useState<CompanyTransporterLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Add-transporter modal
  const [showAdd, setShowAdd] = useState(false);
  const [catalog, setCatalog] = useState<TransportCompany[]>([]);
  const [selectedTc, setSelectedTc] = useState('');
  const [saving, setSaving] = useState(false);

  // Deactivate confirmation
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    setError(null);
    try {
      setLinks(await listForCompany(companyId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => {
    load();
  }, [load]);

  async function openAdd() {
    setShowAdd(true);
    setSelectedTc('');
    try {
      setCatalog(await listAllTransportCompanies());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load transporters');
    }
  }

  // Transport companies not already linked (in any status).
  const linkedIds = new Set(links.map((l) => l.transport_company_id));
  const available = catalog.filter((tc) => !linkedIds.has(tc.id));

  async function handleAdd() {
    if (!companyId || !selectedTc) return;
    setSaving(true);
    try {
      await addLink(companyId, selectedTc);
      toast({ title: isRTL ? 'تمت إضافة الناقل' : 'Transporter added' });
      setShowAdd(false);
      await load();
    } catch (err) {
      toast({
        title: isRTL ? 'فشل إضافة الناقل' : 'Failed to add transporter',
        description: err instanceof Error ? err.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleDeactivate(id: string) {
    setSaving(true);
    try {
      await deactivateLink(id);
      toast({ title: isRTL ? 'تم إلغاء تفعيل الناقل' : 'Transporter deactivated' });
      setConfirmId(null);
      await load();
    } catch (err) {
      toast({
        title: isRTL ? 'فشل إلغاء التفعيل' : 'Failed to deactivate',
        description: err instanceof Error ? err.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  }

  function tcName(link: CompanyTransporterLink): string {
    const tc = link.transport_company;
    if (!tc) return link.transport_company_id.slice(0, 8);
    return isRTL ? tc.name_ar : tc.name_en ?? tc.name_ar;
  }

  return (
    <AppShell role="company">
      <div className={`space-y-6 ${isRTL ? 'rtl' : 'ltr'}`}>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-foreground mb-1">
              {isRTL ? 'الناقلون المعتمدون' : 'Approved Transporters'}
            </h1>
            <p className="text-muted-foreground">
              {isRTL
                ? 'شركات النقل المرتبطة بمنشأتك لجدولة الالتقاطات'
                : 'Transport companies linked to your company for scheduling pickups'}
            </p>
          </div>
          <Button onClick={openAdd} className="gap-2">
            <PlusIcon className="w-4 h-4" />
            {isRTL ? 'إضافة ناقل' : 'Add Transporter'}
          </Button>
        </div>

        {!loading && error && (
          <ErrorState message={error} retry={load} retryLabel={isRTL ? 'إعادة المحاولة' : 'Retry'} />
        )}

        <Card className="bg-card text-card-foreground border-border">
          <CardHeader>
            <CardTitle>{isRTL ? 'الناقلون' : 'Transporters'}</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <LoadingState label={isRTL ? 'جارٍ التحميل' : 'Loading'} />
            ) : error ? null : links.length === 0 ? (
              <EmptyState
                icon={<TruckIcon />}
                title={isRTL ? 'لا يوجد ناقلون مرتبطون' : 'No transporters linked yet'}
                hint={isRTL
                  ? 'أضف شركة نقل معتمدة لتتمكن من جدولة الالتقاطات معها'
                  : 'Add an approved transport company to start scheduling pickups with them'}
                action={{ label: isRTL ? 'إضافة ناقل' : 'Add Transporter', onClick: openAdd }}
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="p-3 text-sm font-medium text-muted-foreground text-start">
                        {isRTL ? 'شركة النقل' : 'Transport Company'}
                      </th>
                      <th className="p-3 text-sm font-medium text-muted-foreground text-start">
                        {isRTL ? 'الحالة' : 'Status'}
                      </th>
                      <th className="p-3 text-sm font-medium text-muted-foreground text-start"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {links.map((link) => (
                      <tr key={link.id} className="border-b border-border">
                        <td className="p-3 text-sm text-foreground">{tcName(link)}</td>
                        <td className="p-3 text-sm">
                          {link.status === 'active' ? (
                            <Badge className="bg-success text-success-foreground hover:bg-success">
                              {isRTL ? 'نشط' : 'Active'}
                            </Badge>
                          ) : (
                            <Badge variant="secondary">
                              {isRTL ? 'غير نشط' : 'Inactive'}
                            </Badge>
                          )}
                        </td>
                        <td className="p-3 text-sm">
                          {link.status === 'active' && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setConfirmId(link.id)}
                              aria-label={isRTL ? `إلغاء تفعيل ${tcName(link)}` : `Deactivate ${tcName(link)}`}
                            >
                              {isRTL ? 'إلغاء التفعيل' : 'Deactivate'}
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Add transporter modal — CP7: was a hand-rolled `fixed inset-0`
          overlay (no focus trap, no Escape handling); converted to the
          shared Modal (Radix Dialog), same as every other dialog in this
          app. */}
      {showAdd && (
        <Modal open onClose={() => setShowAdd(false)} isRTL={isRTL} maxWidth="max-w-md" title={isRTL ? 'إضافة ناقل' : 'Add Transporter'}>
          <div className="space-y-4">
            {available.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4">
                {isRTL
                  ? 'لا توجد شركات نقل إضافية متاحة للربط'
                  : 'No additional transport companies available to link'}
              </p>
            ) : (
              <>
                <div>
                  <label className="text-sm font-medium text-foreground" htmlFor="tc-select">
                    {isRTL ? 'شركة النقل' : 'Transport Company'} *
                  </label>
                  <select
                    id="tc-select"
                    value={selectedTc}
                    onChange={(e) => setSelectedTc(e.target.value)}
                    className="mt-1 w-full border border-input rounded-md px-3 py-2 text-sm bg-background text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                  >
                    <option value="">{isRTL ? 'اختر شركة نقل' : 'Select a transport company'}</option>
                    {available.map((tc) => (
                      <option key={tc.id} value={tc.id}>
                        {tc.name_ar}
                        {tc.name_en ? ` — ${tc.name_en}` : ''}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex gap-3">
                  <Button onClick={handleAdd} disabled={!selectedTc || saving} className="gap-2">
                    {saving && <Loader2Icon className="w-4 h-4 animate-spin" />}
                    {isRTL ? 'ربط' : 'Link'}
                  </Button>
                  <Button variant="outline" onClick={() => setShowAdd(false)}>
                    {isRTL ? 'إلغاء' : 'Cancel'}
                  </Button>
                </div>
              </>
            )}
          </div>
        </Modal>
      )}

      {/* Deactivate confirmation — same conversion. */}
      {confirmId && (
        <Modal open onClose={() => setConfirmId(null)} isRTL={isRTL} maxWidth="max-w-sm" title={isRTL ? 'تأكيد إلغاء التفعيل' : 'Confirm Deactivation'}>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {isRTL
                ? 'سيتم إلغاء تفعيل هذا الناقل ولن يكون متاحًا للجدولة. هل أنت متأكد؟'
                : 'This transporter will be deactivated and unavailable for scheduling. Are you sure?'}
            </p>
            <div className="flex gap-3">
              <Button
                variant="destructive"
                onClick={() => handleDeactivate(confirmId)}
                disabled={saving}
                className="gap-2"
              >
                {saving && <Loader2Icon className="w-4 h-4 animate-spin" />}
                {isRTL ? 'إلغاء التفعيل' : 'Deactivate'}
              </Button>
              <Button variant="outline" onClick={() => setConfirmId(null)}>
                {isRTL ? 'تراجع' : 'Cancel'}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </AppShell>
  );
}
