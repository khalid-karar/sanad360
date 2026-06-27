import type { Request } from 'express';

export interface SinglePickupRequest {
  pickup_event_id: string;
}

export interface MonthlyRequest {
  branch_id: string;
  month: string; // "YYYY-MM", e.g. "2026-06"
}

export interface GenerateResult {
  signed_url: string;
  pdf_path: string;
  sha256_hash: string;
  inspection_pdf_id: string;
}

// Express Request extended with JWT-validated fields (set by authMiddleware)
export interface AuthedRequest extends Request {
  userId: string;
  companyId: string | null;
  transportCompanyId: string | null;
  memberRole: string;
}

// Minimal shapes of the DB rows the service reads
export interface PickupEventRow {
  id: string;
  logical_id: string;
  revision: number;
  company_id: string;
  branch_id: string;
  transport_company_id: string;
  driver_id: string;
  vehicle_id: string;
  waste_types: string[];
  weight_kg: number;
  gps_lat: number | null;
  gps_lng: number | null;
  geofence_verified: boolean;
  qr_code_value: string | null;
  photo_path: string | null;
  receipt_path: string | null;
  signature_path: string | null;
  photo_sha256: string | null;
  receipt_sha256: string | null;
  signature_sha256: string | null;
  risk_score: number;
  risk_flags: string[];
  compliance_status: 'compliant' | 'warning' | 'non_compliant';
  notes: string | null;
  created_at: string;
}

export interface CompanyRow {
  id: string;
  name_ar: string;
  commercial_registration: string;
  vat_number: string | null;
}

export interface BranchRow {
  id: string;
  name_ar: string;
  address_ar: string | null;
  city: string | null;
}

export interface TransportCompanyRow {
  id: string;
  name_ar: string;
  ncwm_license_number: string | null;
  ncwm_license_expiry: string | null;
}

export interface DriverRow {
  id: string;
  name_ar: string;
  license_number: string;
  license_expiry: string;
}

export interface VehicleRow {
  id: string;
  plate_number: string;
  type: string;
  ncwm_license_number: string | null;
  ncwm_license_expiry: string;
}
