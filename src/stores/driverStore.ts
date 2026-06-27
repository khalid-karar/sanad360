import { create } from 'zustand';
import { useNotificationStore } from './notificationStore';
import { useAuthStore } from './authStore';
import { createPickupEvent } from '../lib/api/pickups';
import { uploadSignature, uploadPhoto, uploadReceipt } from '../lib/api/storage';
import { getFirstActiveVehicle } from '../lib/api/vehicles';

// Extended to include QR scan step before geolocation
export type PickupState =
  | 'awaiting'
  | 'qr-scan'
  | 'geolocation-verified'
  | 'manifest'
  | 'signature'
  | 'confirmation';

export interface Pickup {
  id: string;
  company: string;
  address: string;
  wasteType: string;
  time: string;
  completed: boolean;
}

export interface ManifestData {
  date: string;
  time: string;
  location: string;
  generator: string;
  wasteType: string[];
  weight: string;
  // Evidence fields
  gps_lat?: number;
  gps_lng?: number;
  gps_accuracy_m?: number;
  qr_code_value?: string;
  photoFile?: File;
  receiptFile?: File;
}

interface DriverState {
  pickupState: PickupState;
  currentPickup: Pickup | null;
  pickups: Pickup[];
  manifestData: ManifestData;
  signature: string | null;    // base64 data URL from canvas
  isSubmitting: boolean;
  submitError: string | null;
  vehicleId: string | null;    // resolved on first use

  setPickupState: (state: PickupState) => void;
  setCurrentPickup: (pickup: Pickup | null) => void;
  updateManifestData: (data: Partial<ManifestData>) => void;
  setSignature: (signature: string) => void;
  completePickup: () => Promise<void>;
  resetFlow: () => void;
  clearSubmitError: () => void;
}

const initialManifest: ManifestData = {
  date: new Date().toLocaleDateString('ar-SA'),
  time: new Date().toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' }),
  location: '',
  generator: '',
  wasteType: [],
  weight: '',
};

// Seeded branch data shown in the driver's schedule (Phase 1 — static until
// pickup_assignments table is implemented in Phase 2).
const SEEDED_PICKUPS: Pickup[] = [
  {
    id: 'seed-1',
    company: 'شركة المذاق الأصيل للمطاعم – فرع العليا',
    address: 'شارع العليا، حي العليا، الرياض',
    wasteType: 'نفايات عضوية',
    time: '09:00',
    completed: false,
  },
];

export const useDriverStore = create<DriverState>((set, get) => ({
  pickupState: 'awaiting',
  currentPickup: null,
  pickups: SEEDED_PICKUPS,
  manifestData: initialManifest,
  signature: null,
  isSubmitting: false,
  submitError: null,
  vehicleId: null,

  setPickupState: (state) => set({ pickupState: state }),

  setCurrentPickup: (pickup) => set({ currentPickup: pickup }),

  updateManifestData: (data) =>
    set((state) => ({
      manifestData: { ...state.manifestData, ...data },
    })),

  setSignature: (signature) => set({ signature }),

  clearSubmitError: () => set({ submitError: null }),

  completePickup: async () => {
    const state = get();
    const authUser = useAuthStore.getState().user;

    if (!authUser) {
      set({ submitError: 'Not authenticated' });
      return;
    }
    if (!authUser.driver_record_id) {
      set({ submitError: 'Driver record not found. Contact your administrator.' });
      return;
    }
    if (!authUser.transport_company_id) {
      set({ submitError: 'Transport company not associated with this account.' });
      return;
    }
    if (!authUser.branch_id) {
      set({ submitError: 'No branch assigned to this driver account.' });
      return;
    }

    // We need a company_id — the branch's parent company.
    // For Phase 1 we derive it from the seed's known mapping.
    // Phase 2: add company_id to the membership or fetch from the branch record.
    // For now, fetch the branch to get company_id.
    const { getBranch } = await import('../lib/api/companies');
    const branch = await getBranch(authUser.branch_id);
    if (!branch) {
      set({ submitError: 'Branch not found.' });
      return;
    }

    // Resolve vehicle: use first active vehicle for this transport company
    let vehicleId = get().vehicleId;
    if (!vehicleId) {
      const vehicle = await getFirstActiveVehicle();
      vehicleId = vehicle?.id ?? null;
    }
    if (!vehicleId) {
      set({ submitError: 'No active vehicle found for your transport company.' });
      return;
    }
    set({ vehicleId });

    set({ isSubmitting: true, submitError: null });
    try {
      // Generate a stable UUID for this event so we can use it in storage paths
      const eventId = crypto.randomUUID();

      // Upload evidence files in parallel. Each upload computes a SHA-256 of the
      // bytes and returns { path, sha256 }; both are persisted on the pickup event.
      const [signatureRes, photoRes, receiptRes] = await Promise.all([
        state.signature
          ? uploadSignature(branch.company_id, authUser.branch_id, eventId, state.signature)
          : Promise.resolve(undefined),
        state.manifestData.photoFile
          ? uploadPhoto(branch.company_id, authUser.branch_id, eventId, state.manifestData.photoFile)
          : Promise.resolve(undefined),
        state.manifestData.receiptFile
          ? uploadReceipt(branch.company_id, authUser.branch_id, eventId, state.manifestData.receiptFile)
          : Promise.resolve(undefined),
      ]);

      const signaturePath = signatureRes?.path;
      const photoPath = photoRes?.path;
      const receiptPath = receiptRes?.path;

      const weightKg = parseFloat(state.manifestData.weight.replace(/[^\d.]/g, ''));

      await createPickupEvent({
        logical_id: eventId,
        company_id: branch.company_id,
        branch_id: authUser.branch_id,
        transport_company_id: authUser.transport_company_id,
        driver_id: authUser.driver_record_id,
        vehicle_id: vehicleId,
        waste_types: state.manifestData.wasteType,
        weight_kg: weightKg,
        gps_lat: state.manifestData.gps_lat,
        gps_lng: state.manifestData.gps_lng,
        gps_accuracy_m: state.manifestData.gps_accuracy_m,
        qr_code_value: state.manifestData.qr_code_value,
        photo_path: photoPath,
        receipt_path: receiptPath,
        signature_path: signaturePath,
        photo_sha256: photoRes?.sha256,
        receipt_sha256: receiptRes?.sha256,
        signature_sha256: signatureRes?.sha256,
      });

      // Mark pickup as completed in the local schedule list
      set((s) => ({
        pickups: s.pickups.map((p) =>
          p.id === s.currentPickup?.id ? { ...p, completed: true } : p
        ),
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
      const message = err instanceof Error ? err.message : 'Submission failed';
      set({ submitError: message, isSubmitting: false });
    }
  },

  resetFlow: () =>
    set({
      pickupState: 'awaiting',
      currentPickup: null,
      manifestData: {
        ...initialManifest,
        date: new Date().toLocaleDateString('ar-SA'),
        time: new Date().toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' }),
      },
      signature: null,
      submitError: null,
    }),
}));
