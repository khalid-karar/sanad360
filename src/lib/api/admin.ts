import { createClient } from '@supabase/supabase-js';
import { supabase } from '../supabase';
import type { Company, Profile, Database } from '../database.types';

/** List all companies (admin RLS allows full visibility). */
export async function listAllCompanies(): Promise<Company[]> {
  const { data, error } = await supabase
    .from('companies')
    .select('*')
    .order('name_ar');

  if (error) throw error;
  return (data as Company[]) ?? [];
}

/** List all profiles (admin RLS — own-row only for non-admins; admins see all
 *  only if a policy allows it. Falls back to empty if RLS filters). */
export async function listAllUsers(): Promise<Profile[]> {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .order('name_ar');

  if (error) throw error;
  return (data as Profile[]) ?? [];
}

export interface CreateCompanyData {
  name_ar: string;
  name_en?: string;
  commercial_registration: string;
  vat_number?: string;
}

export interface CreateCompanyResult {
  company: Company;
  ownerUserId: string;
}

/**
 * Onboard a new company + owner user. Self-registration is disabled, so this
 * must run with the service role (auth admin + bypass RLS).
 *
 * In the browser the service key is NOT exposed (only VITE_ vars are), so this
 * throws a clear error unless a service key is available in the environment
 * (tests/server). The caller should surface the bilingual message.
 */
export async function createCompanyWithOwner(
  companyData: CreateCompanyData,
  ownerEmail: string,
  ownerPassword: string
): Promise<CreateCompanyResult> {
  const url =
    (import.meta as unknown as { env?: Record<string, string> }).env
      ?.VITE_SUPABASE_URL ??
    (typeof process !== 'undefined' ? process.env.VITE_SUPABASE_URL : undefined);

  const serviceKey =
    typeof process !== 'undefined'
      ? process.env.SUPABASE_SERVICE_ROLE_KEY
      : undefined;

  if (!url || !serviceKey) {
    throw new Error(
      'إنشاء الشركات يتطلب صلاحيات الخادم (service role). / ' +
        'Company onboarding requires server-side service-role credentials.'
    );
  }

  const admin = createClient<Database>(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // 1. Create the owner auth user (email confirmed so they can sign in).
  const { data: userRes, error: userErr } = await admin.auth.admin.createUser({
    email: ownerEmail,
    password: ownerPassword,
    email_confirm: true,
    user_metadata: { name_ar: companyData.name_ar },
  });
  if (userErr || !userRes.user) {
    throw new Error(`createCompanyWithOwner (auth): ${userErr?.message}`);
  }
  const ownerUserId = userRes.user.id;

  // 2. Create the company.
  const { data: company, error: companyErr } = await admin
    .from('companies')
    .insert(companyData)
    .select()
    .single<Company>();
  if (companyErr || !company) {
    throw new Error(`createCompanyWithOwner (company): ${companyErr?.message}`);
  }

  // 3. Link the owner via a membership (handle_new_user already made the profile).
  const { error: memErr } = await admin.from('memberships').insert({
    user_id: ownerUserId,
    role: 'owner',
    company_id: company.id,
  });
  if (memErr) {
    throw new Error(`createCompanyWithOwner (membership): ${memErr.message}`);
  }

  return { company, ownerUserId };
}
