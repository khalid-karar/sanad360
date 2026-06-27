// Auto-generated types matching supabase/migrations/001_initial_schema.sql
// Regenerate with: npx supabase gen types typescript --local

export type MemberRole = 'owner' | 'manager' | 'driver' | 'dispatcher' | 'admin';
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
  branch_id: string | null;
  created_at: string;
}

export interface Driver {
  id: string;
  transport_company_id: string;
  profile_id: string | null;
  name_ar: string;
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
  waste_types: string[];
  weight_kg: number;
  gps_lat: number | null;
  gps_lng: number | null;
  gps_accuracy_m: number | null;
  geofence_verified: boolean;
  qr_code_value: string | null;
  photo_path: string | null;
  receipt_path: string | null;
  signature_path: string | null;
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
  report_type: 'single_pickup' | 'monthly_summary';
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
  waste_types: string[];
  weight_kg: number;
  gps_lat?: number;
  gps_lng?: number;
  gps_accuracy_m?: number;
  qr_code_value?: string;
  photo_path?: string;
  receipt_path?: string;
  signature_path?: string;
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
    };
    Views: {
      pickup_events_latest: { Row: Indexed<PickupEvent>; Relationships: [] };
    };
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
