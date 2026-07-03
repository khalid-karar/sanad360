import type { Response } from 'express';
import { admin } from '../lib/supabase.js';
import { uploadPdf, sha256Hex, recordAndSign } from '../lib/storage.js';
import { renderHtmlToPdf } from '../lib/renderer.js';
import { buildMonthlyCompanyHtml } from '../templates/monthly-company.js';
import type { BranchSection } from '../templates/monthly-company.js';
import { assertCompanyAccess } from '../lib/auth.js';
import type { AuthedRequest, PickupEventRow, CompanyRow, BranchRow } from '../types.js';

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * POST /generate/monthly-company { month: "YYYY-MM" }
 *
 * The company-wide inspection pack: every ACTIVE branch's month in one
 * document — summary table + per-branch detail + custody warnings. The
 * caller's own company is used (admins may pass company_id explicitly).
 */
export async function handleMonthlyCompany(req: AuthedRequest, res: Response): Promise<void> {
  const { month, company_id } = req.body as { month?: string; company_id?: string };

  if (!month || !MONTH_RE.test(month)) {
    res.status(400).json({ error: 'month (YYYY-MM) is required', code: 'BAD_REQUEST' });
    return;
  }

  const companyId = req.memberRole === 'admin' && company_id ? company_id : req.companyId;
  if (!companyId) {
    res.status(403).json({ error: 'No company scope for this caller', code: 'FORBIDDEN' });
    return;
  }
  if (!assertCompanyAccess(req, companyId, res)) return;

  const { data: company, error: companyErr } = await admin
    .from('companies')
    .select('id, name_ar, commercial_registration, vat_number')
    .eq('id', companyId)
    .single<CompanyRow>();
  if (companyErr || !company) {
    res.status(404).json({ error: 'Company not found', code: 'NOT_FOUND' });
    return;
  }

  const { data: branches } = await admin
    .from('branches')
    .select('id, name_ar, address_ar, city')
    .eq('company_id', companyId)
    .eq('status', 'active')
    .order('name_ar');
  const branchRows = (branches ?? []) as BranchRow[];

  const [year, mon] = month.split('-').map(Number) as [number, number];
  const from = new Date(Date.UTC(year, mon - 1, 1)).toISOString();
  const to = new Date(Date.UTC(year, mon, 1, 0, 0, 0, -1)).toISOString();

  // One query for the whole month, grouped client-side per branch.
  const { data: events, error: eventsErr } = await admin
    .from('pickup_events_latest')
    .select('*')
    .eq('company_id', companyId)
    .gte('created_at', from)
    .lte('created_at', to)
    .order('created_at', { ascending: true });
  if (eventsErr) {
    res.status(500).json({ error: 'Failed to fetch pickups', code: 'INTERNAL_ERROR' });
    return;
  }
  const allEvents = (events ?? []) as PickupEventRow[];

  const eventIds = allEvents.map((e) => e.id);
  let confirmedIds: string[] = [];
  if (eventIds.length > 0) {
    const { data: confs } = await admin
      .from('disposal_confirmations')
      .select('pickup_event_id')
      .in('pickup_event_id', eventIds);
    confirmedIds = ((confs ?? []) as { pickup_event_id: string }[]).map((c) => c.pickup_event_id);
  }
  const confirmedSet = new Set(confirmedIds);

  const sections: BranchSection[] = branchRows.map((branch) => {
    const branchEvents = allEvents.filter((e) => e.branch_id === branch.id);
    return {
      branch,
      events: branchEvents,
      custodyConfirmedIds: branchEvents.filter((e) => confirmedSet.has(e.id)).map((e) => e.id),
    };
  });

  const generatedAt = new Date().toISOString();
  const documentId = `${companyId.substring(0, 8).toUpperCase()}-${month}-ALL`;

  const pdfBytes = await renderHtmlToPdf(
    buildMonthlyCompanyHtml({ company, month, sections, documentId, generatedAt })
  );
  const hash = sha256Hex(pdfBytes);

  // Versioned filename; branch-less path segment "company" keeps the prefix
  // convention {company_id}/... intact for the storage policies.
  const pdfPath = await uploadPdf(companyId, 'company', `${month}-all-${hash.slice(0, 12)}.pdf`, pdfBytes);

  const { signedUrl, inspectionPdfId } = await recordAndSign({
    companyId,
    branchId: null,
    pickupEventId: null,
    reportType: 'monthly_company',
    periodMonth: `${month}-01`,
    pdfPath,
    sha256Hash: hash,
    generatedBy: req.userId,
  });

  res.json({
    signed_url: signedUrl,
    pdf_path: pdfPath,
    sha256_hash: hash,
    inspection_pdf_id: inspectionPdfId,
    branches: sections.length,
    pickups: allEvents.length,
  });
}
