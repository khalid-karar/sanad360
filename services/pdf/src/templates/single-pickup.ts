import {
  BASE_CSS, esc, arabicDateTime,
  FLAG_LABELS, WASTE_LABELS, COMPLIANCE_LABELS, VEHICLE_TYPE_LABELS,
} from './base.js';
import type {
  PickupEventRow, CompanyRow, BranchRow,
  TransportCompanyRow, DriverRow, VehicleRow,
} from '../types.js';

interface EvidenceDataUrls {
  photo: string | null;
  receipt: string | null;
  signature: string | null;
}

function evidenceImg(dataUrl: string | null, label: string): string {
  if (dataUrl) {
    return `
      <div class="evidence-item">
        <img src="${dataUrl}" alt="${esc(label)}">
        <div class="evidence-label">${esc(label)}</div>
      </div>`;
  }
  return `
    <div class="evidence-item">
      <div class="evidence-missing">غير مُلتقط</div>
      <div class="evidence-label">${esc(label)}</div>
    </div>`;
}

function badgeClass(status: string): string {
  return `badge-${status}`;
}

export function buildSinglePickupHtml(opts: {
  event: PickupEventRow;
  company: CompanyRow;
  branch: BranchRow;
  transport: TransportCompanyRow;
  driver: DriverRow;
  vehicle: VehicleRow;
  evidence: EvidenceDataUrls;
  documentId: string; // short ID for the footer
  generatedAt: string; // ISO timestamp
}): string {
  const { event, company, branch, transport, driver, vehicle, evidence } = opts;
  const genDateTime = arabicDateTime(opts.generatedAt);
  const eventDateTime = arabicDateTime(event.created_at);

  const wasteAr = event.waste_types
    .map((w) => WASTE_LABELS[w] ?? w)
    .join(' | ');

  const complianceLabel = COMPLIANCE_LABELS[event.compliance_status] ?? event.compliance_status;
  const flagRows = event.risk_flags
    .map((f) => `<span class="flag">${esc(FLAG_LABELS[f] ?? f)}</span>`)
    .join('');

  const gpsText = event.gps_lat && event.gps_lng
    ? `${event.gps_lat.toFixed(5)}, ${event.gps_lng.toFixed(5)}`
    : 'غير متاح';

  const geofenceText = event.geofence_verified ? '✓ داخل النطاق' : '✗ خارج النطاق';
  const geofenceColor = event.geofence_verified ? '#166534' : '#991b1b';

  return `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>ملف التفتيش – تدوير 360</title>
  <style>${BASE_CSS}</style>
</head>
<body>
<div class="page">

  <!-- ── Header ─────────────────────────────────────────────── -->
  <div class="doc-header">
    <div class="logo">تدوير <span class="accent">360</span></div>
    <div class="doc-meta">
      <div>رقم الوثيقة: ${esc(opts.documentId)}</div>
      <div>تاريخ الإصدار: ${esc(genDateTime)}</div>
      <div>رقم المراجعة: ${event.revision}</div>
    </div>
  </div>

  <div class="doc-title">ملف التفتيش على عملية نقل النفايات</div>

  <!-- ── Company & Branch ───────────────────────────────────── -->
  <div class="section">
    <div class="section-header">معلومات المنشأة والفرع</div>
    <div class="section-body">
      <div class="row"><span class="label">اسم الشركة</span><span class="value">${esc(company.name_ar)}</span></div>
      <div class="row"><span class="label">السجل التجاري</span><span class="value">${esc(company.commercial_registration)}</span></div>
      ${company.vat_number ? `<div class="row"><span class="label">الرقم الضريبي</span><span class="value">${esc(company.vat_number)}</span></div>` : ''}
      <div class="row"><span class="label">الفرع</span><span class="value">${esc(branch.name_ar)}</span></div>
      ${branch.address_ar ? `<div class="row"><span class="label">العنوان</span><span class="value">${esc(branch.address_ar)}</span></div>` : ''}
      ${branch.city ? `<div class="row"><span class="label">المدينة</span><span class="value">${esc(branch.city)}</span></div>` : ''}
    </div>
  </div>

  <!-- ── Transport Company ──────────────────────────────────── -->
  <div class="section">
    <div class="section-header">شركة النقل والمركبة</div>
    <div class="section-body">
      <div class="row"><span class="label">اسم شركة النقل</span><span class="value">${esc(transport.name_ar)}</span></div>
      ${transport.ncwm_license_number ? `<div class="row"><span class="label">رقم ترخيص NCWM</span><span class="value">${esc(transport.ncwm_license_number)}</span></div>` : ''}
      ${transport.ncwm_license_expiry ? `<div class="row"><span class="label">تاريخ انتهاء الترخيص</span><span class="value">${esc(transport.ncwm_license_expiry)}</span></div>` : ''}
      <div class="row"><span class="label">لوحة المركبة</span><span class="value">${esc(vehicle.plate_number)}</span></div>
      <div class="row"><span class="label">نوع المركبة</span><span class="value">${esc(VEHICLE_TYPE_LABELS[vehicle.type] ?? vehicle.type)}</span></div>
      ${vehicle.ncwm_license_number ? `<div class="row"><span class="label">رخصة NCWM للمركبة</span><span class="value">${esc(vehicle.ncwm_license_number)}</span></div>` : ''}
      <div class="row"><span class="label">انتهاء رخصة المركبة</span><span class="value">${esc(vehicle.ncwm_license_expiry)}</span></div>
    </div>
  </div>

  <!-- ── Driver ─────────────────────────────────────────────── -->
  <div class="section">
    <div class="section-header">السائق</div>
    <div class="section-body">
      <div class="row"><span class="label">اسم السائق</span><span class="value">${esc(driver.name_ar)}</span></div>
      <div class="row"><span class="label">رقم الرخصة</span><span class="value">${esc(driver.license_number)}</span></div>
      <div class="row"><span class="label">انتهاء الرخصة</span><span class="value">${esc(driver.license_expiry)}</span></div>
    </div>
  </div>

  <!-- ── Waste Details ──────────────────────────────────────── -->
  <div class="section">
    <div class="section-header">تفاصيل النفايات والاستلام</div>
    <div class="section-body">
      <div class="row"><span class="label">أنواع النفايات</span><span class="value">${esc(wasteAr)}</span></div>
      <div class="row"><span class="label">الوزن</span><span class="value">${event.weight_kg} كيلوجرام</span></div>
      <div class="row"><span class="label">التاريخ والوقت</span><span class="value">${esc(eventDateTime)}</span></div>
      ${event.qr_code_value ? `<div class="row"><span class="label">قيمة رمز QR</span><span class="value">${esc(event.qr_code_value)}</span></div>` : ''}
      <div class="row">
        <span class="label">الإحداثيات GPS</span>
        <span class="value">${esc(gpsText)}</span>
      </div>
      <div class="row">
        <span class="label">التحقق الجغرافي</span>
        <span class="value" style="color:${geofenceColor}">${esc(geofenceText)}</span>
      </div>
    </div>
  </div>

  <!-- ── Evidence ───────────────────────────────────────────── -->
  <div class="section">
    <div class="section-header">الأدلة والمستندات</div>
    <div class="section-body">
      <div class="evidence-grid">
        ${evidenceImg(evidence.photo,     'صورة الاستلام')}
        ${evidenceImg(evidence.receipt,   'إيصال النقل')}
        ${evidenceImg(evidence.signature, 'التوقيع')}
      </div>
    </div>
  </div>

  <!-- ── Risk Assessment ────────────────────────────────────── -->
  <div class="section">
    <div class="section-header">تقييم المخاطر والامتثال</div>
    <div class="section-body">
      <div class="row">
        <span class="label">درجة الخطورة</span>
        <span class="value">${event.risk_score} / 100</span>
      </div>
      <div class="row">
        <span class="label">حالة الامتثال</span>
        <span class="value">
          <span class="risk-badge ${badgeClass(event.compliance_status)}">
            ${esc(complianceLabel)}
          </span>
        </span>
      </div>
      ${event.risk_flags.length > 0 ? `
      <div style="margin-top:8px;">
        <div class="label" style="margin-bottom:4px;">العلامات المُفعَّلة</div>
        <div class="flag-list">${flagRows}</div>
      </div>` : '<div class="label" style="margin-top:6px;">✓ لا توجد علامات مخاطر</div>'}
    </div>
  </div>

  ${event.notes ? `
  <div class="section">
    <div class="section-header">ملاحظات</div>
    <div class="section-body">
      <p style="font-size:10.5pt; color:#374151;">${esc(event.notes)}</p>
    </div>
  </div>` : ''}

</div>

<!-- ── Footer (fixed, appears on every page) ──────────────── -->
<div class="footer">
  <span>تدوير 360 — سجل مؤمَّن بتقنية SHA-256</span>
  <span>تاريخ الإصدار: ${esc(genDateTime)}</span>
  <span>للتحقق: راجع قاعدة البيانات برقم الوثيقة ${esc(opts.documentId)}</span>
</div>

</body>
</html>`;
}
