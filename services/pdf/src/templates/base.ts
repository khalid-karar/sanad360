// Shared CSS and font import used by both PDF templates.
// Uses Noto Naskh Arabic from Google Fonts CDN.
// For air-gapped deployments: download the font, base64-encode it, and replace
// the @import with @font-face { src: url(data:font/woff2;base64,...) }.
export const BASE_CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Noto+Naskh+Arabic:wght@400;700&display=swap');

  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  body {
    font-family: 'Noto Naskh Arabic', Arial, sans-serif;
    font-size: 11pt;
    color: #1a1a2e;
    direction: rtl;
    text-align: right;
    line-height: 1.9;
    background: #fff;
  }

  .page { padding: 0; }

  /* ── Header / Branding ─────────────────────────────────────── */
  .doc-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    border-bottom: 3px solid #16213e;
    padding-bottom: 14px;
    margin-bottom: 20px;
  }

  .logo { font-size: 20pt; font-weight: 700; color: #16213e; letter-spacing: -0.5px; }
  .logo .accent { color: #22c55e; }

  .doc-meta { font-size: 9pt; color: #555; text-align: left; line-height: 1.6; }

  .doc-title {
    text-align: center;
    font-size: 15pt;
    font-weight: 700;
    color: #16213e;
    border: 2px solid #16213e;
    border-radius: 6px;
    padding: 8px 16px;
    margin-bottom: 20px;
    background: #f8fafc;
  }

  /* ── Sections ──────────────────────────────────────────────── */
  .section {
    margin-bottom: 16px;
    border: 1px solid #d1d5db;
    border-radius: 8px;
    overflow: hidden;
    break-inside: avoid;
  }

  .section-header {
    background: #16213e;
    color: #fff;
    padding: 7px 14px;
    font-weight: 700;
    font-size: 12pt;
  }

  .section-body { padding: 10px 14px; }

  .row {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    padding: 3px 0;
    border-bottom: 1px solid #f3f4f6;
    gap: 8px;
  }
  .row:last-child { border-bottom: none; }

  .label { color: #6b7280; font-size: 9.5pt; white-space: nowrap; }
  .value { font-weight: 700; color: #111827; font-size: 10.5pt; text-align: left; word-break: break-word; overflow-wrap: anywhere; min-width: 0; }

  /* ── Tamper-evident hashes ─────────────────────────────────── */
  .hashes table { table-layout: fixed; width: 100%; }
  .hashes td { word-break: break-all; overflow-wrap: anywhere; vertical-align: top; }
  .hashes td:first-child { width: 38%; color: #6b7280; font-size: 9pt; }
  .hash {
    font-family: 'Courier New', monospace;
    font-size: 8.5pt;
    line-height: 1.5;
    direction: ltr;
    text-align: left;
    unicode-bidi: plaintext;
    color: #111827;
  }

  /* Incomplete chain-of-custody: must read as a WARNING PANEL, not body text */
  .custody-warning {
    border: 1.5pt solid #991b1b;
    background: #fef2f2;
    color: #991b1b;
    border-radius: 4px;
    padding: 8px 12px;
    font-size: 10.5pt;
    font-weight: 700;
    margin-top: 6px;
  }

  /* ── Evidence thumbnails ───────────────────────────────────── */
  .evidence-grid {
    display: flex;
    gap: 12px;
    margin-top: 6px;
    justify-content: flex-end;
  }

  .evidence-item { text-align: center; flex: 1; max-width: 160px; }

  .evidence-item img {
    width: 100%;
    max-height: 130px;
    object-fit: contain;
    border: 1px solid #d1d5db;
    border-radius: 6px;
    background: #f9fafb;
  }

  .evidence-label { font-size: 9pt; color: #6b7280; margin-top: 4px; }

  .evidence-missing {
    width: 100%;
    height: 80px;
    border: 1px dashed #d1d5db;
    border-radius: 6px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 9pt;
    color: #9ca3af;
  }

  /* ── Risk badge ────────────────────────────────────────────── */
  .risk-row { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }

  .risk-badge {
    display: inline-block;
    padding: 3px 14px;
    border-radius: 20px;
    font-weight: 700;
    font-size: 11pt;
  }

  .badge-compliant     { background: #dcfce7; color: #166534; }
  .badge-warning       { background: #fef9c3; color: #854d0e; }
  .badge-non_compliant { background: #fee2e2; color: #991b1b; }

  .flag-list { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }

  .flag {
    background: #fef3c7;
    color: #92400e;
    border: 1px solid #fde68a;
    padding: 2px 8px;
    border-radius: 4px;
    font-size: 9pt;
  }

  /* ── Footer (printed on every page via @page rule) ─────────── */
  .footer {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    border-top: 1px solid #d1d5db;
    padding: 5px 15mm;
    font-size: 8pt;
    color: #6b7280;
    display: flex;
    justify-content: space-between;
    background: #fff;
  }

  /* ── Tables (monthly summary) ──────────────────────────────── */
  table { width: 100%; border-collapse: collapse; font-size: 9pt; table-layout: fixed; }
  th {
    background: #1e293b;
    color: #fff;
    padding: 6px 8px;
    font-weight: 700;
    text-align: right;
    word-break: break-word;
    overflow-wrap: anywhere;
  }
  td {
    padding: 5px 8px;
    border-bottom: 1px solid #e5e7eb;
    vertical-align: top;
    word-break: break-word;
    overflow-wrap: anywhere;
  }
  tr:nth-child(even) td { background: #f9fafb; }

  .kpi-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 12px;
    margin-bottom: 16px;
  }

  .kpi-card {
    border: 1px solid #d1d5db;
    border-radius: 8px;
    padding: 10px 14px;
    text-align: center;
  }

  .kpi-value { font-size: 22pt; font-weight: 700; color: #16213e; }
  .kpi-label { font-size: 9pt; color: #6b7280; }

  @media print { .footer { position: fixed; } }
`;

// Escapes text so it is safe to embed inside HTML attributes and text nodes.
export function esc(s: string | null | undefined): string {
  if (!s) return '';
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Converts Western digits in a string to Arabic-Indic numerals (٠-٩).
export function toArabicDigits(s: string): string {
  const map = '٠١٢٣٤٥٦٧٨٩';
  return s.replace(/[0-9]/g, (d) => map[Number(d)]);
}

// Hijri date (Umm al-Qura) in Arabic-Indic numerals, e.g. "١٤٤٦/١٢/٠٩ هـ".
export function hijriDate(iso: string): string {
  const d = new Date(iso);
  const parts = new Intl.DateTimeFormat('ar-SA-u-ca-islamic-umalqura-nu-latn', {
    timeZone: 'Asia/Riyadh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const ymd = `${get('year')}/${get('month')}/${get('day')}`;
  return `${toArabicDigits(ymd)} هـ`;
}

// Gregorian date in YYYY-MM-DD (Asia/Riyadh), suffixed with the Arabic "م".
export function gregorianDate(iso: string): string {
  const d = new Date(iso);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Riyadh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')} م`;
}

// Dual calendar string: Hijri (Arabic-Indic) + Gregorian, e.g.
// "١٤٤٦/١٢/٠٩ هـ — 2025-06-15 م".
export function dualDate(iso: string): string {
  return `${hijriDate(iso)} — ${gregorianDate(iso)}`;
}

// Formats an ISO timestamp to a dual Hijri/Gregorian date + Arabic-Indic time
// in Asia/Riyadh timezone.
export function arabicDateTime(iso: string): string {
  const d = new Date(iso);
  const time = d.toLocaleTimeString('ar-SA-u-nu-arab', {
    timeZone: 'Asia/Riyadh',
    hour: '2-digit',
    minute: '2-digit',
  });
  return `${dualDate(iso)} — ${time}`;
}

// Arabic labels for risk flags
export const FLAG_LABELS: Record<string, string> = {
  missing_photo:            'صورة مفقودة',
  missing_signature:        'توقيع مفقود',
  geofence_failed:          'خارج النطاق الجغرافي',
  driver_license_expiring:  'رخصة السائق تنتهي قريباً',
  vehicle_license_expiring: 'رخصة المركبة تنتهي قريباً',
};

// Arabic labels for waste types
export const WASTE_LABELS: Record<string, string> = {
  organic:     'نفايات عضوية',
  food_waste:  'مخلفات غذائية',
  plastic:     'بلاستيك',
  chemical:    'مواد كيميائية',
  industrial:  'نفايات صناعية',
  electronic:  'إلكترونيات',
  medical:     'نفايات طبية',
};

export const COMPLIANCE_LABELS: Record<string, string> = {
  compliant:     'ممتثل',
  warning:       'تحذير',
  non_compliant: 'غير ممتثل',
};

export const VEHICLE_TYPE_LABELS: Record<string, string> = {
  small_truck:  'شاحنة صغيرة',
  medium_truck: 'شاحنة متوسطة',
  large_truck:  'شاحنة كبيرة',
  specialized:  'مركبة متخصصة',
};
