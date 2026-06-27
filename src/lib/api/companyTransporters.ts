// src/lib/api/companyTransporters.ts
// All DB access for the company_transporters many-to-many link.
//
// Replaces the old getTransportCompanyForCompany() hack (which derived the
// transporter from the most-recent pickup_event). A company is now explicitly
// linked to one or more transport companies via the company_transporters table,
// and scheduling resolves eligible drivers/vehicles through those links.

import { supabase } from '../supabase';
import type {
  CompanyTransporter,
  TransportCompany,
  Driver,
  Vehicle,
} from '../database.types';

/** A link row joined with its transport_company details (for the UI table). */
export interface CompanyTransporterLink extends CompanyTransporter {
  transport_company: TransportCompany | null;
}

/**
 * List the full transport_companies catalog (for picking which ones to link).
 * Visible to any company-scoped member via the additive SELECT policy in 004.
 */
export async function listAllTransportCompanies(): Promise<TransportCompany[]> {
  const { data, error } = await supabase
    .from('transport_companies')
    .select('*')
    .order('name_ar');

  if (error) throw error;
  return (data as TransportCompany[]) ?? [];
}

/** List all transporter links for a company (both active and inactive). */
export async function listForCompany(
  companyId: string
): Promise<CompanyTransporterLink[]> {
  const { data, error } = await supabase
    .from('company_transporters')
    .select('*, transport_company:transport_companies(*)')
    .eq('company_id', companyId)
    .order('created_at', { ascending: true });

  if (error) throw error;
  return (data as unknown as CompanyTransporterLink[]) ?? [];
}

/**
 * List only the active transport_companies linked to a company.
 * Returns transport_company rows joined via the link table.
 */
export async function listTransportersForCompany(
  companyId: string
): Promise<TransportCompany[]> {
  const { data, error } = await supabase
    .from('company_transporters')
    .select('transport_company:transport_companies(*)')
    .eq('company_id', companyId)
    .eq('status', 'active');

  if (error) throw error;

  const rows = (data as unknown as { transport_company: TransportCompany | null }[]) ?? [];
  return rows
    .map((r) => r.transport_company)
    .filter((tc): tc is TransportCompany => tc !== null);
}

/** Add a new link (defaults to active). */
export async function addLink(
  companyId: string,
  transportCompanyId: string
): Promise<CompanyTransporter> {
  const { data, error } = await supabase
    .from('company_transporters')
    .insert({
      company_id: companyId,
      transport_company_id: transportCompanyId,
      status: 'active',
    })
    .select()
    .single<CompanyTransporter>();

  if (error) throw error;
  return data;
}

/** Soft-deactivate a link (status -> 'inactive'). */
export async function deactivateLink(id: string): Promise<CompanyTransporter> {
  const { data, error } = await supabase
    .from('company_transporters')
    .update({ status: 'inactive' })
    .eq('id', id)
    .select()
    .single<CompanyTransporter>();

  if (error) throw error;
  return data;
}

/**
 * Core helper used by scheduling.
 *
 * Returns the active drivers + active vehicles available to a company by:
 *   1. resolving all ACTIVE company_transporters links for the company, then
 *   2. fetching active drivers and active vehicles belonging to those
 *      transport companies.
 *
 * Returns empty arrays when the company has no active transporter links.
 */
export async function getDriversAndVehiclesForCompany(
  companyId: string
): Promise<{ drivers: Driver[]; vehicles: Vehicle[] }> {
  const { data: links, error: linkErr } = await supabase
    .from('company_transporters')
    .select('transport_company_id')
    .eq('company_id', companyId)
    .eq('status', 'active');

  if (linkErr) throw linkErr;

  const transportCompanyIds = (
    (links as { transport_company_id: string }[]) ?? []
  ).map((l) => l.transport_company_id);

  if (transportCompanyIds.length === 0) {
    return { drivers: [], vehicles: [] };
  }

  const [driversRes, vehiclesRes] = await Promise.all([
    supabase
      .from('drivers')
      .select('*')
      .in('transport_company_id', transportCompanyIds)
      .eq('status', 'active')
      .order('name_ar'),
    supabase
      .from('vehicles')
      .select('*')
      .in('transport_company_id', transportCompanyIds)
      .eq('status', 'active')
      .order('plate_number'),
  ]);

  if (driversRes.error) throw driversRes.error;
  if (vehiclesRes.error) throw vehiclesRes.error;

  return {
    drivers: (driversRes.data as Driver[]) ?? [],
    vehicles: (vehiclesRes.data as Vehicle[]) ?? [],
  };
}
