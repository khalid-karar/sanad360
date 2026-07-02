import {
  BASE_CSS, esc, arabicDateTime,
  FLAG_LABELS, WASTE_LABELS, COMPLIANCE_LABELS,
} from './base.js';
import type { PickupEventRow, BranchRow, CompanyRow, DriverRow, VehicleRow } from '../types.js';

interface ExpiryWarning {
  type: 'driver' | 'vehicle';
  name: string;
  expiryDate: string;
}

interface MonthlyStats {
  totalPickups: number;
  totalWeight: number;
  compliant: number;
  warning: number;
  nonCompliant: number;
  missingEvidence: number;
}

function computeStats(events: PickupEventRow[]): MonthlyStats {
  return events.reduce(
    (acc, e) => {
      acc.totalPickups++;
      acc.totalWeight += Number(e.weight_kg);
      if (e.compliance_status === 'compliant')     acc.compliant++;
      if (e.compliance_status === 'warning')       acc.warning++;
      if (e.compliance_status === 'non_compliant') acc.nonCompliant++;
      if (!e.photo_path || !e.signature_path)      acc.missingEvidence++;
      return acc;
    },
    { totalPickups: 0, totalWeight: 0, compliant: 0, warning: 0, nonCompliant: 0, missingEvidence: 0 }
  );
}

function badgeClass(status: string): string {
  return `badge-${status}`;
}

export function buildMonthlyHtml(opts: {
  company: CompanyRow;
  branch: BranchRow;
  month: string;          // "YYYY-MM"
  events: PickupEventRow[];
  expiryWarnings: ExpiryWarning[];
  /** Event ids that have a disposal confirmation (chain of custody closed). */
  custodyConfirmedIds?: string[];
  documentId: string;
  generatedAt: string;
}): string {
  const { company, branch, events, expiryWarnings } = opts;
  const stats = computeStats(events);
  const genDateTime = arabicDateTime(opts.generatedAt);
  const custodySet = new Set(opts.custodyConfirmedIds ?? []);
  const custodyMissing = events.filter((e) => !custodySet.has(e.id));

  // Format month as Arabic locale date (first of month)
  const monthDate = new Date(`${opts.month}-01T00:00:00Z`);
  const monthAr = monthDate.toLocaleDateString('ar-SA', {
    year: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  });

  const tableRows = events.map((e, i) => {
    const wasteAr = e.waste_types.map((w) => WASTE_LABELS[w] ?? w).join('، ');
    const complianceLabel = COMPLIANCE_LABELS[e.compliance_status] ?? e.compliance_status;
    const dateStr = new Date(e.created_at).toLocaleDateString('ar-SA', { timeZone: 'Asia/Riyadh' });
    return `
      <tr>
        <td style="text-align:center">${i + 1}</td>
        <td>${esc(dateStr)}</td>
        <td>${esc(wasteAr)}</td>
        <td style="text-align:center">${e.weight_kg}</td>
        <td style="text-align:center">
          <span class="risk-badge ${badgeClass(e.compliance_status)}" style="font-size:8pt; padding:2px 8px;">
            ${esc(complianceLabel)}
          </span>
        </td>
        <td style="text-align:center">${e.risk_score}</td>
        <td style="text-align:center; color:${e.geofence_verified ? '#166534' : '#991b1b'}">
          ${e.geofence_verified ? '✓' : '✗'}
        </td>
        <td style="text-align:center; color:${custodySet.has(e.id) ? '#166534' : '#991b1b'}">
          ${custodySet.has(e.id) ? '✓' : '✗'}
        </td>
        <td style="font-size:8pt; direction:ltr; text-align:left; color:#6b7280">
          ${esc(e.id.substring(0, 8))}...
        </td>
      </tr>`;
  }).join('');

  const warningRows = expiryWarnings.map((w) => `
    <div class="row">
      <span class="label">${w.type === 'driver' ? 'سائق' : 'مركبة'}: ${esc(w.name)}</span>
      <span class="value" style="color:#991b1b">تنتهي: ${esc(w.expiryDate)}</span>
    </div>`).join('');

  return `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>التقرير الشهري – سند 360</title>
  <style>${BASE_CSS}</style>
</head>
<body>
<div class="page">

  <!-- ── Header ─────────────────────────────────────────────── -->
  <div class="doc-header">
    <div class="logo">سند <span class="accent">360</span></div>
    <div class="doc-meta">
      <div>رقم الوثيقة: ${esc(opts.documentId)}</div>
      <div>تاريخ الإصدار: ${esc(genDateTime)}</div>
    </div>
  </div>

  <div class="doc-title">ملخص عمليات نقل النفايات الشهري</div>

  <!-- ── Period & Branch ───────────────────────────────────── -->
  <div class="section">
    <div class="section-header">معلومات الفترة والفرع</div>
    <div class="section-body">
      <div class="row"><span class="label">الشركة</span><span class="value">${esc(company.name_ar)}</span></div>
      <div class="row"><span class="label">السجل التجاري</span><span class="value">${esc(company.commercial_registration)}</span></div>
      <div class="row"><span class="label">الفرع</span><span class="value">${esc(branch.name_ar)}</span></div>
      ${branch.city ? `<div class="row"><span class="label">المدينة</span><span class="value">${esc(branch.city)}</span></div>` : ''}
      <div class="row"><span class="label">الشهر</span><span class="value">${esc(monthAr)}</span></div>
    </div>
  </div>

  <!-- ── KPI Cards ──────────────────────────────────────────── -->
  <div class="kpi-grid">
    <div class="kpi-card">
      <div class="kpi-value">${stats.totalPickups}</div>
      <div class="kpi-label">إجمالي العمليات</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-value">${stats.totalWeight.toFixed(1)}</div>
      <div class="kpi-label">إجمالي الوزن (كجم)</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-value" style="color:${stats.missingEvidence > 0 ? '#991b1b' : '#166534'}">${stats.missingEvidence}</div>
      <div class="kpi-label">عمليات ناقصة الأدلة</div>
    </div>
  </div>

  <!-- ── Compliance Breakdown ───────────────────────────────── -->
  <div class="section">
    <div class="section-header">توزيع حالات الامتثال</div>
    <div class="section-body">
      <div class="row">
        <span class="label"><span class="risk-badge badge-compliant" style="font-size:9pt; padding:2px 10px;">ممتثل</span></span>
        <span class="value">${stats.compliant} عملية</span>
      </div>
      <div class="row">
        <span class="label"><span class="risk-badge badge-warning" style="font-size:9pt; padding:2px 10px;">تحذير</span></span>
        <span class="value">${stats.warning} عملية</span>
      </div>
      <div class="row">
        <span class="label"><span class="risk-badge badge-non_compliant" style="font-size:9pt; padding:2px 10px;">غير ممتثل</span></span>
        <span class="value">${stats.nonCompliant} عملية</span>
      </div>
    </div>
  </div>

  <!-- ── Chain of Custody: disposal leg ─────────────────────── -->
  <div class="section">
    <div class="section-header">سلسلة العهدة — التسليم لمنشآت المعالجة</div>
    <div class="section-body">
      <div class="row">
        <span class="label">عمليات مؤكدة التسليم</span>
        <span class="value" style="color:#166534">${events.length - custodyMissing.length} من ${events.length}</span>
      </div>
      ${custodyMissing.length > 0 ? `
      <div class="custody-warning">
        ⚠ ${custodyMissing.length} عملية بدون تأكيد تسليم لمنشأة معالجة — سلسلة العهدة غير مكتملة
      </div>` : events.length > 0 ? `
      <p style="font-size:10.5pt; color:#166534; margin-top:6px;">
        ✓ سلسلة العهدة مكتملة لجميع عمليات هذا الشهر
      </p>` : ''}
    </div>
  </div>

  ${expiryWarnings.length > 0 ? `
  <!-- ── Expiry Warnings ────────────────────────────────────── -->
  <div class="section">
    <div class="section-header" style="background:#991b1b;">⚠ تحذيرات انتهاء التراخيص</div>
    <div class="section-body">
      ${warningRows}
    </div>
  </div>` : ''}

  <!-- ── Pickups Table ──────────────────────────────────────── -->
  <div class="section">
    <div class="section-header">جدول عمليات الاستلام</div>
    <div class="section-body" style="padding: 0;">
      ${events.length > 0 ? `
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>التاريخ</th>
            <th>أنواع النفايات</th>
            <th>الوزن (كجم)</th>
            <th>حالة الامتثال</th>
            <th>درجة الخطورة</th>
            <th>التحقق الجغرافي</th>
            <th>سلسلة العهدة</th>
            <th style="text-align:left">معرف العملية</th>
          </tr>
        </thead>
        <tbody>${tableRows}</tbody>
      </table>` : `
      <div style="text-align:center; padding:20px; color:#6b7280; font-size:10pt;">
        لا توجد عمليات مسجلة في هذا الشهر
      </div>`}
    </div>
  </div>

</div>

<!-- ── Footer ──────────────────────────────────────────────── -->
<div class="footer">
  <span>سند 360 — سجل مانع للعبث بتقنية SHA-256 · <span style="direction:ltr; unicode-bidi:embed;">Powered by Maya AI</span></span>
  <span>تاريخ الإصدار: ${esc(genDateTime)}</span>
  <span>للتحقق: راجع قاعدة البيانات برقم الوثيقة ${esc(opts.documentId)}</span>
</div>

</body>
</html>`;
}
