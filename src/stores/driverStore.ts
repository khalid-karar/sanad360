import { create } from 'zustand';
import { useNotificationStore } from './notificationStore';
import { useAuthStore } from './authStore';
import { createPickupEvent } from '../lib/api/pickups';
import { uploadSignature, uploadPhoto, uploadReceipt, uploadScalePhoto } from '../lib/api/storage';
import {
  listAssignments,
  updateAssignmentStatus,
  completeAssignment,
} from '../lib/api/assignments';
import { getBranch, getCompany } from '../lib/api/companies';
import { enqueueSubmission, isNetworkError } from '../lib/offline/pickupQueue';
import type { PickupAssignment } from '../lib/database.types';

// Evidence capture state machine: QR scan → GPS → manifest → signature → submit
export type PickupState =
  | 'awaiting'
  | 'qr-scan'
  | 'geolocation-verified'
  | 'manifest'
  | 'signature'
  | 'confirmation';

/** A real pickup_assignments row enriched with display names the driver can
 *  read thanks to migration 009 (linked-transporter SELECT on branches/companies). */
export interface AssignmentView {
  assignment: PickupAssignment;
  companyName: string;
  branchName: string;
  branchAddress: string;
}

export interface ManifestData {
  location: string;
  generator: string;
  wasteType: string[];
  weight: string; // plain numeric string, e.g. "42.5"
  // Evidence fields
  gps_lat?: number;
  gps_lng?: number;
  gps_accuracy_m?: number;
  qr_code_value?: string;
  photoFile?: File;
  scalePhotoFile?: File;
  receiptFile?: File;
}

interface DriverState {
  pickupState: PickupState;
  assignments: AssignmentView[];
  assignmentsLoading: boolean;
  assignmentsError: string | null;
  currentAssignment: AssignmentView | null;
  manifestData: ManifestData;
  signature: string | null; // base64 data URL from canvas
  isSubmitting: boolean;
  submitError: string | null;
  /** True when the submission was persisted to the offline queue instead of
   *  sent — it will sync automatically when connectivity returns. */
  queuedOffline: boolean;
  /** Set once the ledger insert succeeds, so a retry after a failed
   *  assignment-completion update never double-inserts the pickup event. */
  createdEventId: string | null;

  setPickupState: (state: PickupState) => void;
  loadAssignments: () => Promise<void>;
  /** Enter the evidence flow for a real assignment (accepts + starts it). */
  beginPickup: (assignment: PickupAssignment) => Promise<void>;
  updateManifestData: (data: Partial<ManifestData>) => void;
  setSignature: (signature: string) => void;
  completePickup: () => Promise<void>;
  resetFlow: () => void;
  clearSubmitError: () => void;
}

const initialManifest: ManifestData = {
  location: '',
  generator: '',
  wasteType: [],
  weight: '',
};

/** Statuses a driver can still act on. */
const ACTIONABLE: PickupAssignment['status'][] = ['pending', 'accepted', 'in_progress'];

async function enrich(assignment: PickupAssignment): Promise<AssignmentView> {
  const [branch, company] = await Promise.all([
    getBranch(assignment.branch_id),
    getCompany(assignment.company_id),
  ]);
  return {
    assignment,
    companyName: company?.name_ar ?? '—',
    branchName: branch?.name_ar ?? '—',
    branchAddress: branch?.address_ar ?? branch?.city ?? '',
  };
}

export const useDriverStore = create<DriverState>((set, get) => ({
  pickupState: 'awaiting',
  assignments: [],
  assignmentsLoading: false,
  assignmentsError: null,
  currentAssignment: null,
  manifestData: initialManifest,
  signature: null,
  isSubmitting: false,
  submitError: null,
  queuedOffline: false,
  createdEventId: null,

  setPickupState: (state) => set({ pickupState: state }),

  updateManifestData: (data) =>
    set((state) => ({
      manifestData: { ...state.manifestData, ...data },
    })),

  setSignature: (signature) => set({ signature }),

  clearSubmitError: () => set({ submitError: null }),

  loadAssignments: async () => {
    const authUser = useAuthStore.getState().user;
    if (!authUser?.driver_record_id) {
      set({
        assignments: [],
        assignmentsError: 'No driver record linked to this account.',
      });
      return;
    }
    set({ assignmentsLoading: true, assignmentsError: null });
    try {
      const rows = await listAssignments({ driverId: authUser.driver_record_id });
      const active = rows.filter((a) => ACTIONABLE.includes(a.status));
      const views = await Promise.all(active.map(enrich));
      set({ assignments: views, assignmentsLoading: false });
    } catch (err) {
      set({
        assignmentsError: err instanceof Error ? err.message : 'Failed to load assignments',
        assignmentsLoading: false,
      });
    }
  },

  beginPickup: async (assignment) => {
    // Reuse an already-enriched view when we have one; enrich otherwise
    // (MySchedulePage hands us a bare row).
    const existing = get().assignments.find((v) => v.assignment.id === assignment.id);
    const view = existing ?? (await enrich(assignment));

    // Flip to in_progress so dispatch sees the job is being worked.
    let started = view.assignment;
    if (started.status !== 'in_progress') {
      started = await updateAssignmentStatus(started.id, 'in_progress');
    }

    set({
      currentAssignment: { ...view, assignment: started },
      manifestData: {
        ...initialManifest,
        location: view.branchAddress || view.branchName,
        generator: view.companyName,
      },
      signature: null,
      submitError: null,
      queuedOffline: false,
      createdEventId: null,
      pickupState: 'qr-scan',
    });
  },

  completePickup: async () => {
    const state = get();
    const authUser = useAuthStore.getState().user;
    const view = state.currentAssignment;

    if (!authUser) {
      set({ submitError: 'Not authenticated' });
      return;
    }
    if (!authUser.transport_company_id) {
      set({ submitError: 'Transport company not associated with this account.' });
      return;
    }
    if (!view) {
      set({ submitError: 'No active assignment for this pickup.' });
      return;
    }

    const a = view.assignment;
    // The ledger records who was actually present: the signed-in driver's own
    // record when it exists, falling back to the assigned driver.
    const driverId = authUser.driver_record_id ?? a.driver_id;

    set({ isSubmitting: true, submitError: null, queuedOffline: false });
    try {
      let eventId = state.createdEventId;

      if (!eventId) {
        // Stable UUID used for the storage paths AND as the ledger logical_id.
        const newEventId = crypto.randomUUID();

        // Upload evidence in parallel; each returns { path, sha256 } and both
        // are persisted on the pickup event (re-verified server-side by the
        // PDF service).
        const [signatureRes, photoRes, receiptRes, scaleRes] = await Promise.all([
          state.signature
            ? uploadSignature(a.company_id, a.branch_id, newEventId, state.signature)
            : Promise.resolve(undefined),
          state.manifestData.photoFile
            ? uploadPhoto(a.company_id, a.branch_id, newEventId, state.manifestData.photoFile)
            : Promise.resolve(undefined),
          state.manifestData.receiptFile
            ? uploadReceipt(a.company_id, a.branch_id, newEventId, state.manifestData.receiptFile)
            : Promise.resolve(undefined),
          state.manifestData.scalePhotoFile
            ? uploadScalePhoto(a.company_id, a.branch_id, newEventId, state.manifestData.scalePhotoFile)
            : Promise.resolve(undefined),
        ]);

        const event = await createPickupEvent({
          logical_id: newEventId,
          company_id: a.company_id,
          branch_id: a.branch_id,
          transport_company_id: authUser.transport_company_id,
          driver_id: driverId,
          vehicle_id: a.vehicle_id,
          // Carries the dispatcher's trip grouping (migration 019) onto the
          // ledger row at the ONLY point it can be set — pickup_events is
          // append-only, so trip_id is never UPDATEd after the fact.
          trip_id: a.trip_id ?? undefined,
          waste_types: state.manifestData.wasteType,
          weight_kg: parseFloat(state.manifestData.weight),
          gps_lat: state.manifestData.gps_lat,
          gps_lng: state.manifestData.gps_lng,
          gps_accuracy_m: state.manifestData.gps_accuracy_m,
          qr_code_value: state.manifestData.qr_code_value,
          photo_path: photoRes?.path,
          scale_photo_path: scaleRes?.path,
          receipt_path: receiptRes?.path,
          signature_path: signatureRes?.path,
          photo_sha256: photoRes?.sha256,
          scale_photo_sha256: scaleRes?.sha256,
          receipt_sha256: receiptRes?.sha256,
          signature_sha256: signatureRes?.sha256,
        });
        eventId = event.id;
        set({ createdEventId: eventId });
      }

      // Link the ledger event and flip the assignment to completed. If this
      // fails, retry re-runs ONLY this step (createdEventId guards the insert).
      await completeAssignment(a.id, eventId);

      set((s) => ({
        assignments: s.assignments.filter((v) => v.assignment.id !== a.id),
        isSubmitting: false,
      }));

      useNotificationStore.getState().addNotification({
        type: 'success',
        priority: 'medium',
        title: 'تم إكمال الالتقاط بنجاح',
        titleEn: 'Pickup Completed Successfully',
        message: 'تم حفظ البيان الرقمي بشكل دائم في النظام',
        messageEn: 'Digital manifest permanently saved to the system',
        role: 'driver',
        autoHide: true,
        duration: 5000,
      });
    } catch (err) {
      // Connectivity failure → persist the full submission to IndexedDB and
      // let the sync triggers replay it when the network returns. A server
      // REJECTION (RLS, validation, trigger) still surfaces as an error.
      if (isNetworkError(err) && !state.createdEventId) {
        try {
          await enqueueSubmission({
            eventId: crypto.randomUUID(),
            assignmentId: a.id,
            companyId: a.company_id,
            branchId: a.branch_id,
            transportCompanyId: authUser.transport_company_id,
            driverId,
            vehicleId: a.vehicle_id,
            wasteTypes: state.manifestData.wasteType,
            weightKg: parseFloat(state.manifestData.weight),
            gpsLat: state.manifestData.gps_lat,
            gpsLng: state.manifestData.gps_lng,
            gpsAccuracyM: state.manifestData.gps_accuracy_m,
            qrCodeValue: state.manifestData.qr_code_value,
            signatureDataUrl: state.signature ?? undefined,
            photoBlob: state.manifestData.photoFile,
            photoName: state.manifestData.photoFile?.name,
            photoType: state.manifestData.photoFile?.type,
            receiptBlob: state.manifestData.receiptFile,
            receiptName: state.manifestData.receiptFile?.name,
            receiptType: state.manifestData.receiptFile?.type,
            scaleBlob: state.manifestData.scalePhotoFile,
            scaleName: state.manifestData.scalePhotoFile?.name,
            scaleType: state.manifestData.scalePhotoFile?.type,
            queuedAt: Date.now(),
            attempts: 0,
          });
          set((s) => ({
            assignments: s.assignments.filter((v) => v.assignment.id !== a.id),
            queuedOffline: true,
            isSubmitting: false,
          }));
          return;
        } catch {
          // IndexedDB unavailable — fall through to the normal error path.
        }
      }
      const message = err instanceof Error ? err.message : 'Submission failed';
      set({ submitError: message, isSubmitting: false });
    }
  },

  resetFlow: () =>
    set({
      pickupState: 'awaiting',
      currentAssignment: null,
      manifestData: initialManifest,
      signature: null,
      submitError: null,
      queuedOffline: false,
      createdEventId: null,
    }),
}));
