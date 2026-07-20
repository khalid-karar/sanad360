// Auto-generated types matching supabase/migrations/001_initial_schema.sql
// Regenerate with: npx supabase gen types typescript --local

export type MemberRole =
  | 'owner' | 'manager' | 'driver' | 'dispatcher' | 'admin'
  // CP1 (migration 017): recycler-side roles, tenant-scoped to a facility.
  | 'recycler_manager' | 'scale_operator';
export type WasteType = 'industrial' | 'plastic' | 'chemical' | 'organic' | 'electronic' | 'medical';
export type ComplianceStatus = 'compliant' | 'warning' | 'non_compliant';

export interface Company {
  id: string;
  name_ar: string;
  name_en: string | null;
  commercial_registration: string;
  vat_number: string | null;
  created_at: string;
}

export interface Branch {
  id: string;
  company_id: string;
  name_ar: string;
  name_en: string | null;
  address_ar: string | null;
  city: string | null;
  geofence_lat: number | null;
  geofence_lng: number | null;
  geofence_radius_m: number;
  status: 'active' | 'inactive';
  /** Secret printed as the facility QR board; scans are verified against it
   *  server-side (migration 013). */
  qr_token: string;
  created_at: string;
}

export interface TransportCompany {
  id: string;
  name_ar: string;
  name_en: string | null;
  commercial_registration: string;
  ncwm_license_number: string | null;
  ncwm_license_expiry: string | null;
  created_at: string;
}

export interface Profile {
  id: string;
  name_ar: string;
  name_en: string | null;
  phone: string | null;
  created_at: string;
}

export interface Membership {
  id: string;
  user_id: string;
  role: MemberRole;
  company_id: string | null;
  transport_company_id: string | null;
  /** CP1 (migration 018): the third tenant type — recycling facility. */
  facility_id: string | null;
  branch_id: string | null;
  created_at: string;
}

// ─── CP1: recycler facilities, trips, weight reconciliation ────────────────

export interface Facility {
  id: string;
  name_ar: string;
  name_en: string | null;
  license_number: string | null;
  license_expiry: string | null;
  city: string | null;
  geofence_lat: number | null;
  geofence_lng: number | null;
  geofence_radius_m: number;
  status: 'active' | 'inactive';
  created_at: string;
}

export interface FacilityTransporter {
  id: string;
  facility_id: string;
  transport_company_id: string;
  status: 'active' | 'inactive';
  created_at: string;
}

export type TripStatus = 'planned' | 'in_progress' | 'dropped_off' | 'reconciled' | 'cancelled';
export type WeightReconciliationStatus = 'pending' | 'within_tolerance' | 'flagged';

export interface Trip {
  id: string;
  transport_company_id: string;
  driver_id: string;
  vehicle_id: string;
  planned_facility_id: string;
  /** v1 scope: a single waste stream per trip. */
  waste_stream: string;
  trip_date: string;
  status: TripStatus;
  /** Server-computed only — see trips_before_update trigger (migration 018). */
  weight_reconciliation_status: WeightReconciliationStatus;
  reconciled_net_weight_kg: number | null;
  reconciled_pickup_weight_kg: number | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export type CreateTripInput = {
  transport_company_id: string;
  driver_id: string;
  vehicle_id: string;
  planned_facility_id: string;
  waste_stream: string;
  trip_date?: string;
};

export interface WasteStreamTolerance {
  waste_stream: string;
  tolerance_pct: number;
  updated_at: string;
}

export interface Driver {
  id: string;
  transport_company_id: string;
  profile_id: string | null;
  name_ar: string;
  /** For WhatsApp deep-links; captured at invite time. PII — PDPL-erased. */
  phone: string | null;
  license_number: string;
  license_expiry: string;
  absher_verified: boolean;
  status: 'active' | 'inactive' | 'suspended';
  created_at: string;
}

export interface Vehicle {
  id: string;
  transport_company_id: string;
  plate_number: string;
  type: 'small_truck' | 'medium_truck' | 'large_truck' | 'specialized';
  waste_license_type: 'general' | 'medical' | 'hazardous' | 'industrial' | 'electronic';
  ncwm_license_number: string | null;
  ncwm_license_expiry: string;
  status: 'active' | 'inactive';
  created_at: string;
}

export interface PickupEvent {
  id: string;
  logical_id: string;
  revision: number;
  supersedes_id: string | null;
  company_id: string;
  branch_id: string;
  transport_company_id: string;
  driver_id: string;
  vehicle_id: string;
  /** CP1 (migration 018): optional link grouping curb pickups into a haul. */
  trip_id: string | null;
  waste_types: string[];
  weight_kg: number;
  gps_lat: number | null;
  gps_lng: number | null;
  gps_accuracy_m: number | null;
  geofence_verified: boolean;
  qr_verified: boolean;
  qr_code_value: string | null;
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
  compliance_status: ComplianceStatus;
  notes: string | null;
  created_by: string;
  created_at: string;
}

export interface AuditLog {
  id: string;
  user_id: string | null;
  tenant_id: string | null;
  tenant_type: string | null;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  changes: Record<string, unknown> | null;
  ip_address: string | null;
  created_at: string;
}

export interface InspectionPdf {
  id: string;
  company_id: string;
  branch_id: string | null;
  pickup_event_id: string | null;
  report_type: 'single_pickup' | 'monthly_summary' | 'monthly_company';
  period_month: string | null;
  pdf_path: string;
  sha256_hash: string;
  generated_by: string;
  created_at: string;
}

// Input types for API calls (omit server-set fields)
export type CreatePickupEventInput = {
  logical_id?: string;       // omit for new event; set for revision
  revision?: number;         // omit for new event (defaults to 1)
  supersedes_id?: string;    // set only for corrections
  company_id: string;
  branch_id: string;
  transport_company_id: string;
  driver_id: string;
  vehicle_id: string;
  trip_id?: string;
  waste_types: string[];
  weight_kg: number;
  gps_lat?: number;
  gps_lng?: number;
  gps_accuracy_m?: number;
  qr_code_value?: string;
  photo_path?: string;
  scale_photo_path?: string;
  receipt_path?: string;
  signature_path?: string;
  photo_sha256?: string;
  scale_photo_sha256?: string;
  receipt_sha256?: string;
  signature_sha256?: string;
  notes?: string;
};

export type CreateDriverInput = Omit<Driver, 'id' | 'created_at'>;
export type CreateVehicleInput = Omit<Vehicle, 'id' | 'created_at'>;

// ─── Phase 3 tables ──────────────────────────────────────────────────────────

export type AssignmentStatus =
  | 'pending' | 'accepted' | 'in_progress' | 'completed' | 'cancelled';

export interface PickupAssignment {
  id: string;
  company_id: string;
  branch_id: string;
  driver_id: string;
  vehicle_id: string;
  scheduled_at: string;
  /** Recurrence series (migration 016): completing spawns the next occurrence. */
  recurrence: 'none' | 'daily' | 'weekly';
  recurrence_until: string | null;
  status: AssignmentStatus;
  pickup_event_id: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export type CreateAssignmentInput = {
  company_id: string;
  branch_id: string;
  driver_id: string;
  vehicle_id: string;
  scheduled_at: string;
  recurrence?: 'none' | 'daily' | 'weekly';
  recurrence_until?: string;
  notes?: string;
  created_by?: string;
};

export interface AlertAcknowledgement {
  id: string;
  company_id: string;
  alert_key: string;
  acknowledged_by: string | null;
  acknowledged_at: string;
}

export interface NotificationRow {
  id: string;
  profile_id: string;
  company_id: string | null;
  title_ar: string;
  title_en: string;
  body_ar: string | null;
  body_en: string | null;
  link: string | null;
  is_read: boolean;
  created_at: string;
}

export interface CompanyTransporter {
  id: string;
  company_id: string;
  transport_company_id: string;
  status: 'active' | 'inactive';
  created_at: string;
}

// The membership a user is currently "acting as" (migration 012). Self-managed;
// my_membership() prefers it and falls back to the oldest membership.
export interface UserActiveTenant {
  user_id: string;
  membership_id: string;
  updated_at: string;
}

// Append-only chain-of-custody record (migration 018 rework): the RECYCLER's
// own, independent confirmation of a trip's drop-off — one row per trip.
// facility_id/transport_company_id/confirmed_by/confirmed_at are server-set
// by triggers from the referenced trip; the client never supplies them.
export interface DisposalConfirmation {
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

export type CreateDisposalConfirmationInput = {
  trip_id: string;
  status: 'confirmed' | 'rejected';
  reject_reason?: string;
  net_weight_kg?: number;
  weighbridge_photo_path?: string;
  weighbridge_photo_sha256?: string;
  gps_lat?: number;
  gps_lng?: number;
  notes?: string;
};

// Each table exposes Row (full read shape), Insert (write shape — server-set
// columns optional), and Update (all columns optional). supabase-js uses Insert
// for `.insert()` and Update for `.update()`. We model Insert/Update as
// Partial<Row> because the API layer always supplies the required columns and
// the DB/triggers fill the rest; this keeps the typed client permissive enough
// for our hand-written input types while still type-checking column names.
// Mapped-type wrapper: our Row shapes are `interface`s, which (unlike type
// literals) are NOT assignable to `Record<string, unknown>` and therefore fail
// supabase-js's `GenericSchema` constraint — silently collapsing every table to
// `never`. Re-mapping the keys produces an index-signature-compatible object
// type that satisfies the constraint while preserving the original columns.
type Indexed<Row> = { [K in keyof Row]: Row[K] };

type TableShape<Row> = {
  Row: Indexed<Row>;
  Insert: Partial<Indexed<Row>>;
  Update: Partial<Indexed<Row>>;
  Relationships: [];
};

export interface Database {
  public: {
    Tables: {
      companies: TableShape<Company>;
      branches: TableShape<Branch>;
      transport_companies: TableShape<TransportCompany>;
      profiles: TableShape<Profile>;
      memberships: TableShape<Membership>;
      drivers: TableShape<Driver>;
      vehicles: TableShape<Vehicle>;
      pickup_events: TableShape<PickupEvent>;
      audit_log: TableShape<AuditLog>;
      inspection_pdfs: TableShape<InspectionPdf>;
      pickup_assignments: TableShape<PickupAssignment>;
      alert_acknowledgements: TableShape<AlertAcknowledgement>;
      notifications: TableShape<NotificationRow>;
      company_transporters: TableShape<CompanyTransporter>;
      disposal_confirmations: TableShape<DisposalConfirmation>;
      user_active_tenant: TableShape<UserActiveTenant>;
      facilities: TableShape<Facility>;
      facility_transporters: TableShape<FacilityTransporter>;
      trips: TableShape<Trip>;
      waste_stream_tolerances: TableShape<WasteStreamTolerance>;
    };
    Views: {
      pickup_events_latest: { Row: Indexed<PickupEvent>; Relationships: [] };
    };
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
