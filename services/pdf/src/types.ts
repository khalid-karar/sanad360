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

// Server-side integrity verdict for one evidence file:
//   verified    – file downloaded, server hash equals the ledger hash
//   mismatch    – ledger hash present but the file is missing or hashes differ
//   unavailable – no evidence claimed, or no ledger hash to verify against
export type HashCheck = 'verified' | 'mismatch' | 'unavailable';

export interface EvidenceHashChecks {
  photo: HashCheck;
  receipt: HashCheck;
  signature: HashCheck;
  scale: HashCheck;
}

// Express Request extended with JWT-validated fields (set by authMiddleware)
export interface AuthedRequest extends Request {
  userId: string;
  companyId: string | null;
  transportCompanyId: string | null;
  /** CP1 (migration 018): set when the active membership is facility-scoped. */
  facilityId: string | null;
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
  trip_id: string | null;
  waste_types: string[];
  weight_kg: number;
  gps_lat: number | null;
  gps_lng: number | null;
  geofence_verified: boolean;
  qr_verified: boolean;
  qr_code_value: string | null;
  qr_skip_reason: string | null;
  qr_skip_reason_notes: string | null;
  photo_path: string | null;
  scale_photo_path: string | null;
  receipt_path: string | null;
  signature_path: string | null;
  photo_sha256: string | null;
  scale_photo_sha256: string | null;
  receipt_sha256: string | null;
  signature_sha256: string | null;
  risk_score: number;
  risk_flags: string[];
  compliance_status: 'compliant' | 'warning' | 'non_compliant';
  notes: string | null;
  created_at: string;
}

// Chain-of-custody row (migration 018 rework) — one per trip, append-only,
// written independently by the RECEIVING facility's scale_operator.
export interface DisposalRow {
  id: string;
  trip_id: string;
  facility_id: string;
  transport_company_id: string;
  status: 'confirmed' | 'rejected';
  reject_reason: string | null;
  net_weight_kg: number | null;
  weighbridge_photo_path: string | null;
  weighbridge_photo_sha256: string | null;
  gps_lat: number | null;
  gps_lng: number | null;
  notes: string | null;
  confirmed_by: string | null;
  confirmed_at: string | null;
  created_at: string;
}

// Consignment/haul row (migration 018) — MUTABLE, audit-logged.
export interface TripRow {
  id: string;
  transport_company_id: string;
  driver_id: string;
  vehicle_id: string;
  planned_facility_id: string;
  waste_stream: string;
  trip_date: string;
  status: 'planned' | 'in_progress' | 'dropped_off' | 'reconciled' | 'cancelled';
  weight_reconciliation_status: 'pending' | 'within_tolerance' | 'flagged';
  reconciled_net_weight_kg: number | null;
  reconciled_pickup_weight_kg: number | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface FacilityRow {
  id: string;
  name_ar: string;
  name_en: string | null;
  license_number: string | null;
  city: string | null;
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
