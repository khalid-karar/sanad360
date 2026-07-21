import { BASE_CSS, esc, arabicDateTime, COMPLIANCE_LABELS } from './base.js';
import type { PickupEventRow, BranchRow, CompanyRow } from '../types.js';

/**
 * Company-wide monthly report: one document covering EVERY branch — the
 * "inspection pack" a compliance manager pulls before an inspector visit
 * instead of generating branch reports one by one.
 */

export interface BranchSection {
  branch: BranchRow;
  events: PickupEventRow[];
  custodyConfirmedIds: string[];
}

export interface BranchStats {
  total: number;
  weight: number;
  compliant: number;
  warning: number;
  nonCompliant: number;
  pendingConfirmation: number;
  custodyMissing: number;
}

export function stats(section: BranchSection): BranchStats {
  const custody = new Set(section.custodyConfirmedIds);
  return section.events.reduce(
    (acc, e) => {
      acc.total++;
      acc.weight += Number(e.weight_kg);
      // Exhaustive switch, not independent ifs — see monthly-summary.ts's
      // computeStats for why (a 5th value fails loudly instead of vanishing).
      switch (e.compliance_status) {
        case 'compliant':            acc.compliant++; break;
        case 'warning':              acc.warning++; break;
        case 'non_compliant':        acc.nonCompliant++; break;
        case 'pending_confirmation': acc.pendingConfirmation++; break;
      }
      if (!custody.has(e.id)) acc.custodyMissing++;
      return acc;
    },
    { total: 0, weight: 0, compliant: 0, warning: 0, nonCompliant: 0, pendingConfirmation: 0, custodyMissing: 0 }
  );
}

export function buildMonthlyCompanyHtml(opts: {
  company: CompanyRow;
  month: string; // "YYYY-MM"
  sections: BranchSection[];
  documentId: string;
  generatedAt: string;
}): string {
  const { company, sections } = opts;
  const genDateTime = arabicDateTime(opts.generatedAt);
  const monthAr = new Date(`${opts.month}-01T00:00:00Z`).toLocaleDateString('ar-SA-u-ca-gregory-nu-latn', {
    year: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  });

  const perBranch = sections.map((sec) => ({ sec, st: stats(sec) }));
  const totals = perBranch.reduce(
    (acc, { st }) => ({
      total: acc.total + st.total,
      weight: acc.weight + st.weight,
      compliant: acc.compliant + st.compliant,
      warning: acc.warning + st.warning,
      nonCompliant: acc.nonCompliant + st.nonCompliant,
      pendingConfirmation: acc.pendingConfirmation + st.pendingConfirmation,
      custodyMissing: acc.custodyMissing + st.custodyMissing,
    }),
    { total: 0, weight: 0, compliant: 0, warning: 0, nonCompliant: 0, pendingConfirmation: 0, custodyMissing: 0 }
  );

  const branchRows = perBranch
    .map(({ sec, st }) => `
      <tr>
        <td>${esc(sec.branch.name_ar)}</td>
        <td style="text-align:center">${st.total}</td>
        <td style="text-align:center">${st.weight.toFixed(1)}</td>
        <td style="text-align:center; color:#166534">${st.compliant}</td>
        <td style="text-align:center; color:#a16207">${st.warning}</td>
        <td style="text-align:center; color:#991b1b">${st.nonCompliant}</td>
        <td style="text-align:center; color:#3730a3">${st.pendingConfirmation}</td>
        <td style="text-align:center; color:${st.custodyMissing > 0 ? '#991b1b' : '#166534'}">
          ${st.total - st.custodyMissing} / ${st.total}
        </td>
      </tr>`)
    .join('');

  const branchDetails = perBranch
    .filter(({ st }) => st.total > 0)
    .map(({ sec }) => {
      const rows = sec.events
        .map((e, i) => {
          const custody = new Set(sec.custodyConfirmedIds);
          const label = COMPLIANCE_LABELS[e.compliance_status] ?? e.compliance_status;
          const dateStr = new Date(e.created_at).toLocaleDateString('ar-SA-u-ca-gregory-nu-latn', { timeZone: 'Asia/Riyadh' });
          return `
            <tr>
              <td style="text-align:center">${i + 1}</td>
              <td>${esc(dateStr)}</td>
              <td style="text-align:center">${e.weight_kg}</td>
              <td style="text-align:center"><span class="risk-badge badge-${e.compliance_status}" style="font-size:8pt; padding:2px 8px;">${esc(label)}</span></td>
              <td style="text-align:center; color:${e.geofence_verified ? '#166534' : '#991b1b'}">${e.geofence_verified ? '✓' : '✗'}</td>
              <td style="text-align:center; color:${custody.has(e.id) ? '#166534' : '#991b1b'}">${custody.has(e.id) ? '✓' : '✗'}</td>
              <td style="font-size:8pt; direction:ltr; text-align:left; color:#6b7280">${esc(e.id.substring(0, 8))}...</td>
            </tr>`;
        })
        .join('');
      return `
        <div class="section">
          <div class="section-header">${esc(sec.branch.name_ar)}${sec.branch.city ? ' — ' + esc(sec.branch.city) : ''}</div>
          <div class="section-body" style="padding:0;">
            <table>
              <thead>
                <tr>
                  <th>#</th><th>التاريخ</th><th>الوزن (كجم)</th><th>الامتثال</th>
                  <th>التحقق الجغرافي</th><th>سلسلة العهدة</th><th style="text-align:left">المعرف</th>
                </tr>
              </thead>
              <tbody>${rows}</tbody>
            </table>
          </div>
        </div>`;
    })
    .join('');

  return `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>التقرير الشهري الشامل – سند 360</title>
  <style>${BASE_CSS}</style>
</head>
<body>
<div class="page">

  <div class="doc-header">
    <div class="logo">سند <span class="accent">360</span></div>
    <div class="doc-meta">
      <div>رقم الوثيقة: ${esc(opts.documentId)}</div>
      <div>تاريخ الإصدار: ${esc(genDateTime)}</div>
    </div>
  </div>

  <div class="doc-title">التقرير الشهري الشامل — جميع الفروع</div>

  <div class="section">
    <div class="section-header">معلومات المنشأة والفترة</div>
    <div class="section-body">
      <div class="row"><span class="label">الشركة</span><span class="value">${esc(company.name_ar)}</span></div>
      <div class="row"><span class="label">السجل التجاري</span><span class="value">${esc(company.commercial_registration)}</span></div>
      <div class="row"><span class="label">الشهر</span><span class="value">${esc(monthAr)}</span></div>
      <div class="row"><span class="label">عدد الفروع</span><span class="value">${sections.length}</span></div>
    </div>
  </div>

  <div class="kpi-grid">
    <div class="kpi-card"><div class="kpi-value">${totals.total}</div><div class="kpi-label">إجمالي العمليات</div></div>
    <div class="kpi-card"><div class="kpi-value">${totals.weight.toFixed(1)}</div><div class="kpi-label">إجمالي الوزن (كجم)</div></div>
    <div class="kpi-card"><div class="kpi-value" style="color:${totals.nonCompliant > 0 ? '#991b1b' : '#166534'}">${totals.nonCompliant}</div><div class="kpi-label">عمليات غير ممتثلة</div></div>
    <div class="kpi-card"><div class="kpi-value" style="color:#3730a3">${totals.pendingConfirmation}</div><div class="kpi-label">بانتظار تأكيد الفرع</div></div>
  </div>

  <div class="section">
    <div class="section-header">ملخص الفروع</div>
    <div class="section-body" style="padding:0;">
      <table>
        <thead>
          <tr>
            <th>الفرع</th><th>العمليات</th><th>الوزن (كجم)</th>
            <th>ممتثل</th><th>تحذير</th><th>غير ممتثل</th><th>بانتظار التأكيد</th><th>سلسلة العهدة</th>
          </tr>
        </thead>
        <tbody>${branchRows}</tbody>
      </table>
    </div>
  </div>

  ${totals.custodyMissing > 0 ? `
  <div class="custody-warning">
    ⚠ ${totals.custodyMissing} عملية عبر الفروع بدون تأكيد تسليم لمنشأة معالجة — سلسلة العهدة غير مكتملة
  </div>` : totals.total > 0 ? `
  <p style="font-size:10.5pt; color:#166534;">✓ سلسلة العهدة مكتملة لجميع عمليات هذا الشهر عبر كل الفروع</p>` : ''}

  ${branchDetails}

</div>

<div class="footer">
  <span>سند 360 — سجل مانع للعبث بتقنية SHA-256 · <span style="direction:ltr; unicode-bidi:embed;">Powered by Maya AI</span></span>
  <span>تاريخ الإصدار: ${esc(genDateTime)}</span>
  <span>للتحقق: راجع قاعدة البيانات برقم الوثيقة ${esc(opts.documentId)}</span>
</div>

</body>
</html>`;
}
