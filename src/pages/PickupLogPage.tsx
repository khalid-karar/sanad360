import { useEffect, useMemo, useState } from 'react';
import { useAuthStore } from '../stores/authStore';
import { StatusPill } from '@/components/ui/status-pill';
import { DatePicker } from '@/components/ui/date-picker';
import AppShell from '../components/AppShell';
import { listPickupEvents, exportPickupsCsv } from '../lib/api/pickups';
import { listDrivers } from '../lib/api/drivers';
import { listVehicles } from '../lib/api/vehicles';
import { listBranches } from '../lib/api/branches';
import type { PickupEvent, Driver, Vehicle, Branch } from '../lib/database.types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  CalendarIcon, TruckIcon, UserIcon, WeightIcon, DownloadIcon, EyeIcon,
  CheckCircle2Icon, AlertTriangleIcon, XCircleIcon, MapPinIcon, XIcon,
} from 'lucide-react';

export default function PickupLogPage() {
  const { isRTL, user } = useAuthStore();
  // This page is shared by /company/pickups and /transport/pickups.
  // AppShell used to hardcode role="company" regardless of which route (or
  // which tenant) rendered it: a transport user landing on /transport/pickups
  // got the COMPANY sidebar (wrong nav links, wrong "منشأة" badge). Clicking
  // that sidebar's "سجل الالتقاطات" then routed to /company/pickups, whose
  // guard let a transport owner/manager through anyway (no company_id check)
  // — or bounced a dispatcher through /login back to /transport — producing
  // an infinite-feeling back-and-forth. Inferring the role from the actual
  // signed-in user (transport_company_id set = transport tenant) fixes the
  // sidebar for both routes with no route-specific logic needed.
  const shellRole = user?.transport_company_id ? 'transport' : 'company';

  const [events, setEvents] = useState<PickupEvent[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<PickupEvent | null>(null);

  // Mobile: the 4-field filter block eats a full screen — collapsed by default
  const [showFilters, setShowFilters] = useState(false);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [branchId, setBranchId] = useState('all');
  const [status, setStatus] = useState('all');

  const driverName = (id: string) => drivers.find((d) => d.id === id)?.name_ar ?? id.slice(0, 8);
  const vehiclePlate = (id: string) => vehicles.find((v) => v.id === id)?.plate_number ?? id.slice(0, 8);
  const branchName = (id: string) =>
    branches.find((b) => b.id === id)?.[isRTL ? 'name_ar' : 'name_en'] ?? branches.find((b) => b.id === id)?.name_ar ?? id.slice(0, 8);

  async function loadEvents() {
    setLoading(true);
    try {
      const data = await listPickupEvents({
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
        branchId: branchId === 'all' ? undefined : branchId,
        status: status === 'all' ? undefined : status,
      });
      setEvents(data);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // Reference lists for name resolution + filter dropdowns
    listDrivers().then(setDrivers).catch(() => {});
    listVehicles().then(setVehicles).catch(() => {});
    listBranches().then(setBranches).catch(() => {});
  }, []);

  useEffect(() => {
    loadEvents();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateFrom, dateTo, branchId, status]);

  const counts = useMemo(() => ({
    total: events.length,
    compliant: events.filter((e) => e.compliance_status === 'compliant').length,
    warning: events.filter((e) => e.compliance_status === 'warning').length,
    nonCompliant: events.filter((e) => e.compliance_status === 'non_compliant').length,
  }), [events]);

  function handleExport() {
    const csv = exportPickupsCsv(events);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pickup-log-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
  }

  // Design system: THE compliance visual — same pill everywhere.
  function statusBadge(s: PickupEvent['compliance_status']) {
    return <StatusPill status={s} isRTL={isRTL} />;
  }

  return (
    <AppShell role={shellRole}>
      <div className={`space-y-8 ${isRTL ? 'rtl' : 'ltr'}`}>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-foreground mb-2">
              {isRTL ? 'سجل الالتقاطات' : 'Pickup Log'}
            </h1>
            <p className="text-muted-foreground">
              {isRTL ? 'تتبع جميع عمليات الالتقاط الفعلية' : 'Track all real pickup operations'}
            </p>
          </div>
          <Button onClick={handleExport} className="bg-primary text-primary-foreground hover:bg-primary/90">
            <DownloadIcon className="w-4 h-4 me-2" />
            {isRTL ? 'تصدير CSV' : 'Export CSV'}
          </Button>
        </div>

        {/* Filters — always open on desktop, toggle on mobile */}
        <Card className="bg-card text-card-foreground border-border">
          <CardHeader>
            <button
              type="button"
              className="w-full flex items-center justify-between md:pointer-events-none"
              onClick={() => setShowFilters((v) => !v)}
              aria-expanded={showFilters}
            >
              <CardTitle className="text-foreground text-lg">{isRTL ? 'المرشحات' : 'Filters'}</CardTitle>
              <span className="md:hidden text-sm text-primary font-medium">
                {showFilters ? (isRTL ? 'إخفاء' : 'Hide') : (isRTL ? 'إظهار' : 'Show')}
              </span>
            </button>
          </CardHeader>
          <CardContent className={showFilters ? '' : 'hidden md:block'}>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div>
                <Label className="text-foreground">{isRTL ? 'من تاريخ' : 'Date From'}</Label>
                <div className="mt-2"><DatePicker value={dateFrom} onChange={setDateFrom} isRTL={isRTL} /></div>
              </div>
              <div>
                <Label className="text-foreground">{isRTL ? 'إلى تاريخ' : 'Date To'}</Label>
                <div className="mt-2"><DatePicker value={dateTo} onChange={setDateTo} isRTL={isRTL} /></div>
              </div>
              <div>
                <Label className="text-foreground">{isRTL ? 'الفرع' : 'Branch'}</Label>
                <Select value={branchId} onValueChange={setBranchId}>
                  <SelectTrigger className="mt-2">
                    <SelectValue placeholder={isRTL ? 'جميع الفروع' : 'All Branches'} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{isRTL ? 'جميع الفروع' : 'All Branches'}</SelectItem>
                    {branches.map((b) => (
                      <SelectItem key={b.id} value={b.id}>{isRTL ? b.name_ar : (b.name_en ?? b.name_ar)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-foreground">{isRTL ? 'حالة الامتثال' : 'Compliance Status'}</Label>
                <Select value={status} onValueChange={setStatus}>
                  <SelectTrigger className="mt-2">
                    <SelectValue placeholder={isRTL ? 'جميع الحالات' : 'All Statuses'} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{isRTL ? 'جميع الحالات' : 'All Statuses'}</SelectItem>
                    <SelectItem value="compliant">{isRTL ? 'ممتثل' : 'Compliant'}</SelectItem>
                    <SelectItem value="warning">{isRTL ? 'تحذير' : 'Warning'}</SelectItem>
                    <SelectItem value="non_compliant">{isRTL ? 'غير ممتثل' : 'Non-Compliant'}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Summary */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
          {[
            { labelAr: 'الإجمالي', labelEn: 'Total', value: counts.total, Icon: CalendarIcon, cls: 'text-foreground' },
            { labelAr: 'ممتثلة', labelEn: 'Compliant', value: counts.compliant, Icon: CheckCircle2Icon, cls: 'text-success' },
            { labelAr: 'تحذيرات', labelEn: 'Warnings', value: counts.warning, Icon: AlertTriangleIcon, cls: 'text-warning' },
            { labelAr: 'غير ممتثلة', labelEn: 'Non-Compliant', value: counts.nonCompliant, Icon: XCircleIcon, cls: 'text-destructive' },
          ].map((c) => (
            <Card key={c.labelEn} className="bg-card text-card-foreground border-border">
              <CardContent className="pt-6 flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">{isRTL ? c.labelAr : c.labelEn}</p>
                  <p className={`text-2xl font-bold ${c.cls}`}>{c.value}</p>
                </div>
                <c.Icon className={`w-8 h-8 ${c.cls}`} />
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Records */}
        <Card className="bg-card text-card-foreground border-border">
          <CardHeader>
            <CardTitle className="text-foreground">
              {isRTL ? 'السجلات' : 'Records'} ({events.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[600px] pr-4">
              <div className="space-y-4">
                {loading && (
                  <div className="text-center py-12 text-muted-foreground">{isRTL ? 'جارٍ التحميل...' : 'Loading...'}</div>
                )}
                {!loading && events.length === 0 && (
                  <div className="text-center py-12 text-muted-foreground">
                    {isRTL ? 'لا توجد سجلات' : 'No records found'}
                  </div>
                )}
                {events.map((e) => (
                  <Card key={e.id} className={`border-2 ${
                    e.compliance_status === 'compliant' ? 'bg-success/5 border-success/20'
                    : e.compliance_status === 'warning' ? 'bg-warning/5 border-warning/20'
                    : 'bg-destructive/5 border-destructive/20'}`}>
                    <CardContent className="pt-6">
                      <div className="flex items-center justify-between mb-4">
                        <div>
                          <h3 className="font-semibold text-foreground text-lg">{branchName(e.branch_id)}</h3>
                          <p className="text-sm text-muted-foreground">{new Date(e.created_at).toLocaleString(isRTL ? 'ar-SA' : 'en-CA')}</p>
                        </div>
                        <div className="flex items-center gap-3">
                          {statusBadge(e.compliance_status)}
                          <Button size="sm" variant="outline" onClick={() => setDetail(e)}>
                            <EyeIcon className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                        <div className="flex items-center gap-2"><UserIcon className="w-4 h-4 text-muted-foreground" />{driverName(e.driver_id)}</div>
                        <div className="flex items-center gap-2"><TruckIcon className="w-4 h-4 text-muted-foreground" />{vehiclePlate(e.vehicle_id)}</div>
                        <div className="flex items-center gap-2"><WeightIcon className="w-4 h-4 text-muted-foreground" />{e.weight_kg} {isRTL ? 'كجم' : 'kg'}</div>
                        <div className="flex items-center gap-2"><MapPinIcon className={`w-4 h-4 ${e.geofence_verified ? 'text-success' : 'text-destructive'}`} />{e.geofence_verified ? (isRTL ? 'داخل النطاق' : 'In geofence') : (isRTL ? 'خارج النطاق' : 'Out of range')}</div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      </div>

      {/* Detail drawer */}
      {detail && (
        <div className="fixed inset-0 bg-gray-900/50 z-50 flex items-start justify-end p-4">
          <Card className="w-full max-w-md bg-card text-card-foreground border-border max-h-[90vh] flex flex-col mt-16">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-foreground">{isRTL ? 'تفاصيل الالتقاط' : 'Pickup Detail'}</CardTitle>
              <Button variant="ghost" size="icon" onClick={() => setDetail(null)}><XIcon className="w-5 h-5" /></Button>
            </CardHeader>
            <CardContent className="overflow-y-auto space-y-2 text-sm">
              {[
                [isRTL ? 'المعرّف' : 'ID', detail.id],
                [isRTL ? 'التاريخ' : 'Date', new Date(detail.created_at).toLocaleString(isRTL ? 'ar-SA' : 'en-CA')],
                [isRTL ? 'الفرع' : 'Branch', branchName(detail.branch_id)],
                [isRTL ? 'السائق' : 'Driver', driverName(detail.driver_id)],
                [isRTL ? 'المركبة' : 'Vehicle', vehiclePlate(detail.vehicle_id)],
                [isRTL ? 'أنواع النفايات' : 'Waste types', detail.waste_types.join('، ')],
                [isRTL ? 'الوزن' : 'Weight', `${detail.weight_kg} ${isRTL ? 'كجم' : 'kg'}`],
                [isRTL ? 'حالة الامتثال' : 'Compliance', detail.compliance_status],
                [isRTL ? 'درجة الخطورة' : 'Risk score', `${detail.risk_score}/100`],
                [isRTL ? 'علامات الخطورة' : 'Risk flags', detail.risk_flags.join('، ') || '—'],
                [isRTL ? 'التحقق الجغرافي' : 'Geofence verified', detail.geofence_verified ? (isRTL ? 'نعم' : 'Yes') : (isRTL ? 'لا' : 'No')],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between gap-4 border-b border-border py-1.5">
                  <span className="text-muted-foreground">{k}</span>
                  <span className="text-foreground text-right break-all">{v}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      )}
    </AppShell>
  );
}
