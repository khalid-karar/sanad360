import {
  BASE_CSS, esc, arabicDateTime,
  flagLabel, isPolicyViolationFlag, WASTE_LABELS, COMPLIANCE_LABELS, VEHICLE_TYPE_LABELS,
} from './base.js';
import type {
  PickupEventRow, CompanyRow, BranchRow,
  TransportCompanyRow, DriverRow, VehicleRow,
  HashCheck, EvidenceHashChecks, DisposalRow, FacilityRow, TripRow,
  PickupConfirmationRow,
} from '../types.js';

const QR_SKIP_REASON_LABELS: Record<string, string> = {
  device_unavailable:         'لا يوجد جهاز/رمز في الموقع',
  scan_failed:                'تعذّر المسح',
  not_applicable_for_stream:  'لا ينطبق على نوع النفايات',
  other:                      'سبب آخر',
};

const CONFIRMATION_METHOD_LABELS: Record<PickupConfirmationRow['method'], string> = {
  in_app_confirm:              'تأكيد داخل التطبيق',
  signature_on_driver_device:  'توقيع على جهاز السائق (بديل أضعف)',
  unavailable:                 'غير متاح',
};

const RECONCILIATION_LABELS: Record<TripRow['weight_reconciliation_status'], string> = {
  pending: 'قيد المطابقة',
  within_tolerance: '✓ ضمن الحد المسموح',
  flagged: '⚠ فرق يتجاوز الحد المسموح — يتطلب مراجعة',
};

// Render the server-side verification verdict next to an evidence hash.
function hashVerdict(check: HashCheck | undefined): string {
  switch (check) {
    case 'verified':
      return ' <span style="color:#166534">✓ تم التحقق من الخادم</span>';
    case 'mismatch':
      return ' <span style="color:#991b1b">✗ غير مطابق للملف المخزَّن</span>';
    default:
      return '';
  }
}

interface EvidenceDataUrls {
  photo: string | null;
  receipt: string | null;
  signature: string | null;
  scale: string | null;
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
  hashChecks?: EvidenceHashChecks; // server-side re-hash verdicts (threaded from the route)
  disposal?: DisposalRow | null;   // recycler's own confirmation of the trip (migration 018)
  disposalFacility?: FacilityRow | null; // the confirming facility's identity
  disposalPhotoCheck?: HashCheck;  // server-side re-hash verdict for the weighbridge photo
  trip?: TripRow | null;           // the trip this pickup was grouped into, for reconciliation result
  branchConfirmation?: PickupConfirmationRow | null; // branch_operator's own attestation (migration 026/030)
  branchConfirmationSignatureCheck?: HashCheck;       // server-side re-hash verdict for its signature
  documentId: string; // short ID for the footer
  generatedAt: string; // ISO timestamp
  pdfSha256?: string;  // SHA-256 of the rendered PDF bytes (threaded from the route)
}): string {
  const { event, company, branch, transport, driver, vehicle, evidence } = opts;
  const genDateTime = arabicDateTime(opts.generatedAt);
  const eventDateTime = arabicDateTime(event.created_at);

  const wasteAr = event.waste_types
    .map((w) => WASTE_LABELS[w] ?? w)
    .join(' | ');

  const complianceLabel = COMPLIANCE_LABELS[event.compliance_status] ?? event.compliance_status;
  const flagRows = event.risk_flags
    .map((f) => `<span class="${isPolicyViolationFlag(f) ? 'flag-violation' : 'flag'}">${esc(flagLabel(f))}</span>`)
    .join('');
  // Decision 4 (022): non_compliant can mean "policy gap" (a required item is
  // missing) rather than "risk score" — distinguish the two so a manager
  // never reads a policy violation as a routine elevated-risk case.
  const hasPolicyViolation = event.risk_flags.some(isPolicyViolationFlag);

  const gpsText = event.gps_lat && event.gps_lng
    ? `${event.gps_lat.toFixed(5)}, ${event.gps_lng.toFixed(5)}`
    : 'غير متاح';

  // Honest claim: the geofence check is computed server-side, but the GPS fix
  // itself comes from the driver's device sensor.
  const geofenceText = event.geofence_verified
    ? '✓ داخل النطاق (وفق جهاز السائق)'
    : '✗ خارج النطاق / موقع غير مؤكد';
  const geofenceColor = event.geofence_verified ? '#166534' : '#991b1b';

  return `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>ملف التفتيش – سند 360</title>
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
      ${event.qr_code_value ? `<div class="row"><span class="label">التحقق من رمز QR</span><span class="value" style="color:${event.qr_verified ? '#166534' : '#991b1b'}">${event.qr_verified ? '✓ مطابق للفرع' : '✗ غير مطابق'}</span></div>` : ''}
      ${!event.qr_code_value && event.qr_skip_reason ? `<div class="row"><span class="label">سبب تخطي رمز QR</span><span class="value">${esc(QR_SKIP_REASON_LABELS[event.qr_skip_reason] ?? event.qr_skip_reason)}${event.qr_skip_reason_notes ? ` — ${esc(event.qr_skip_reason_notes)}` : ''}</span></div>` : ''}
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
        ${evidenceImg(evidence.scale,     'شاشة الميزان')}
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
      ${event.compliance_status === 'non_compliant' && hasPolicyViolation ? `
      <div class="custody-warning" style="margin-top:8px;">⚠ غير ممتثل بسبب نقص دليل إلزامي وفق السياسة — بصرف النظر عن درجة الخطورة</div>
      ` : ''}
      ${event.compliance_status === 'pending_confirmation' ? `
      <div class="custody-warning" style="margin-top:8px; border-color:#3730a3; background:#e0e7ff; color:#3730a3;">⏳ بانتظار تأكيد مشغّل الفرع — هذه العملية ليست ممتثلة بعد، بصرف النظر عن درجة الخطورة، إلى حين ورود التأكيد المطلوب (انظر قسم تأكيد الفرع أدناه)</div>
      ` : ''}
      ${event.risk_flags.length > 0 ? `
      <div style="margin-top:8px;">
        <div class="label" style="margin-bottom:4px;">العلامات المُفعَّلة</div>
        <div class="flag-list">${flagRows}</div>
      </div>` : '<div class="label" style="margin-top:6px;">✓ لا توجد علامات مخاطر</div>'}
    </div>
  </div>

  <!-- ── Branch confirmation (migration 026/030) — the branch_operator's own
       attestation of THIS pickup. Rendered whenever the pickup is (or was)
       pending_confirmation, OR a confirmation row exists — omitted only for
       ordinary pickups where branch confirmation was never required at
       all, to avoid noise on the vast majority of reports. ── -->
  ${event.compliance_status === 'pending_confirmation' || opts.branchConfirmation || event.risk_flags.some((f) => f === 'confirmation_window_expired' || f === 'branch_confirmation_disputed') ? `
  <div class="section">
    <div class="section-header">تأكيد فرع الاستلام</div>
    <div class="section-body">
      ${!opts.branchConfirmation ? (
        event.risk_flags.includes('confirmation_window_expired')
          ? `<div class="custody-warning">⚠ انتهت مهلة تأكيد الفرع دون ورود أي تأكيد — العملية غير ممتثلة الآن</div>`
          : `<div class="custody-warning">⏳ بانتظار تأكيد مشغّل الفرع لهذه العملية — لم يرد أي تأكيد بعد</div>`
      ) : opts.branchConfirmation.status === 'disputed' ? `
      <div class="custody-warning">⚠ نازع مشغّل الفرع هذه العملية — السبب: ${esc(opts.branchConfirmation.dispute_reason ?? 'غير محدد')}</div>
      ` : `
      ${event.risk_flags.includes('missing_required:branch_confirmation') && event.risk_flags.includes('reduced_verification') ? `
      <div class="custody-warning">⚠ طريقة التأكيد المُستخدَمة لا تفي بمتطلبات السياسة — العملية غير ممتثلة رغم وجود تأكيد</div>
      ` : ''}
      <div class="row"><span class="label">طريقة التأكيد</span><span class="value">${esc(CONFIRMATION_METHOD_LABELS[opts.branchConfirmation.method] ?? opts.branchConfirmation.method)}</span></div>
      <div class="row"><span class="label">تاريخ التأكيد</span><span class="value">${esc(arabicDateTime(opts.branchConfirmation.confirmed_at ?? opts.branchConfirmation.created_at))}</span></div>
      ${opts.branchConfirmation.signature_path ? `
      <div class="row">
        <span class="label">توقيع مشغّل الفرع SHA-256</span>
        <span class="value hash">${esc(opts.branchConfirmation.signature_sha256 ?? 'N/A')}${hashVerdict(opts.branchConfirmationSignatureCheck)}</span>
      </div>` : ''}
      ${opts.branchConfirmation.gps_lat && opts.branchConfirmation.gps_lng
        ? `<div class="row"><span class="label">إحداثيات التأكيد</span><span class="value">${opts.branchConfirmation.gps_lat.toFixed(5)}, ${opts.branchConfirmation.gps_lng.toFixed(5)}</span></div>`
        : ''}
      ${opts.branchConfirmation.notes ? `<div class="row"><span class="label">ملاحظات</span><span class="value">${esc(opts.branchConfirmation.notes)}</span></div>` : ''}
      `}
    </div>
  </div>
  ` : ''}

  <!-- ── Chain of Custody: recycler-confirmed disposal leg (migration 018) ── -->
  <div class="section">
    <div class="section-header">سلسلة العهدة — تأكيد منشأة إعادة التدوير</div>
    <div class="section-body">
      ${opts.disposal && opts.disposal.status === 'confirmed' ? `
      <div class="row"><span class="label">حالة التأكيد</span><span class="value" style="color:#166534">✓ مؤكَّد من المنشأة</span></div>
      ${opts.disposalFacility ? `<div class="row"><span class="label">منشأة المعالجة</span><span class="value">${esc(opts.disposalFacility.name_ar)}</span></div>` : ''}
      ${opts.disposalFacility?.license_number ? `<div class="row"><span class="label">رقم ترخيص المنشأة</span><span class="value">${esc(opts.disposalFacility.license_number)}</span></div>` : ''}
      <div class="row"><span class="label">تاريخ التأكيد</span><span class="value">${esc(arabicDateTime(opts.disposal.confirmed_at ?? opts.disposal.created_at))}</span></div>
      <div class="row"><span class="label">الوزن الصافي</span><span class="value">${opts.disposal.net_weight_kg != null ? `${opts.disposal.net_weight_kg} كجم` : 'N/A'}</span></div>
      ${opts.trip ? `<div class="row"><span class="label">نتيجة مطابقة الوزن</span><span class="value">${esc(RECONCILIATION_LABELS[opts.trip.weight_reconciliation_status])}</span></div>` : ''}
      ${opts.disposal.gps_lat && opts.disposal.gps_lng
        ? `<div class="row"><span class="label">إحداثيات التأكيد</span><span class="value">${opts.disposal.gps_lat.toFixed(5)}, ${opts.disposal.gps_lng.toFixed(5)}</span></div>`
        : ''}
      <div class="row">
        <span class="label">صورة الميزان SHA-256</span>
        <span class="value hash">${esc(opts.disposal.weighbridge_photo_sha256 ?? 'N/A')}${hashVerdict(opts.disposalPhotoCheck)}</span>
      </div>
      ${opts.disposal.notes ? `<div class="row"><span class="label">ملاحظات</span><span class="value">${esc(opts.disposal.notes)}</span></div>` : ''}
      ` : opts.disposal && opts.disposal.status === 'rejected' ? `
      <div class="custody-warning">⚠ رفضت المنشأة استلام هذه الشحنة — السبب: ${esc(opts.disposal.reject_reason ?? 'غير محدد')}</div>
      ` : `
      <div class="custody-warning">⚠ لم تؤكد أي منشأة استلام هذا الالتقاط بعد — سلسلة العهدة غير مكتملة</div>
      `}
    </div>
  </div>

  ${event.notes ? `
  <div class="section">
    <div class="section-header">ملاحظات</div>
    <div class="section-body">
      <p style="font-size:10.5pt; color:#374151;">${esc(event.notes)}</p>
    </div>
  </div>` : ''}

  <!-- ── Tamper-evident hashes ──────────────────────────────── -->
  <div class="section hashes">
    <div class="section-header">سجل موثّق مانع للتلاعب / Tamper-Evident Record</div>
    <div class="section-body">
      <table>
        <tr><td>رقم التعريف / Reference</td><td class="hash">${esc(event.id)}</td></tr>
        <tr><td>تجزئة الصورة / Photo SHA-256</td><td class="hash">${esc(event.photo_sha256 ?? 'N/A')}${hashVerdict(opts.hashChecks?.photo)}</td></tr>
        <tr><td>تجزئة التوقيع / Signature SHA-256</td><td class="hash">${esc(event.signature_sha256 ?? 'N/A')}${hashVerdict(opts.hashChecks?.signature)}</td></tr>
        <tr><td>تجزئة صورة الميزان / Scale SHA-256</td><td class="hash">${esc(event.scale_photo_sha256 ?? 'N/A')}${hashVerdict(opts.hashChecks?.scale)}</td></tr>
        <tr><td>تجزئة الإيصال / Receipt SHA-256</td><td class="hash">${esc(event.receipt_sha256 ?? 'N/A')}${hashVerdict(opts.hashChecks?.receipt)}</td></tr>
        <tr><td>تجزئة الملف / PDF SHA-256</td><td class="hash">${esc(opts.pdfSha256 ?? 'N/A')}</td></tr>
      </table>
      <p style="font-size:8.5pt; color:#6b7280; margin-top:8px;">
        نطاق التحقق: تجزئات الملفات يُعاد حسابها خادمياً من الملفات المخزَّنة، ورمز QR يُطابَق مع رمز الفرع السري.
        الموقع الجغرافي ودقّته مُبلَّغان من مستشعر جهاز السائق ولا يمكن للخادم إثبات أصالتهما.
        <span dir="ltr" style="display:block; text-align:left;">Verification scope: file hashes are re-computed server-side from the stored files; the QR is matched against the branch secret. GPS position and accuracy are reported by the driver's device sensor and their authenticity cannot be proven by the server.</span>
      </p>
    </div>
  </div>

</div>

<!-- ── Footer (fixed, appears on every page) ──────────────── -->
<div class="footer">
  <span>سند 360 — سجل مانع للعبث بتقنية SHA-256 · <span style="direction:ltr; unicode-bidi:embed;">Powered by Maya AI</span></span>
  <span>تاريخ الإصدار: ${esc(genDateTime)}</span>
  <span>للتحقق: راجع قاعدة البيانات برقم الوثيقة ${esc(opts.documentId)}</span>
</div>

</body>
</html>`;
}
