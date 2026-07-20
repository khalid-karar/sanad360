import { create } from 'zustand';
import { useNotificationStore } from './notificationStore';
import { listDrivers, createDriver, updateDriver } from '../lib/api/drivers';
import { listVehicles, createVehicle, updateVehicle } from '../lib/api/vehicles';
import type { Driver, Vehicle, CreateDriverInput, CreateVehicleInput } from '../lib/database.types';

export type AlertType = 'warning' | 'critical';
export type AlertStatus = 'pending' | 'corrected' | 'resolved';

export interface Alert {
  id: string;
  type: AlertType;
  facility: string;
  date: string;
  time: string;
  issue: string;
  issueEn: string;
  status: AlertStatus;
  priority: 'high' | 'medium' | 'low';
}

export interface PickupRecord {
  id: string;
  date: string;
  facility: string;
  driver: string;
  vehicle: string;
  wasteType: string;
  weight: string;
  complianceStatus: 'compliant' | 'warning' | 'non-compliant';
}

// Re-export DB types with the names the existing UI components expect
export type { Driver, Vehicle };

interface TransportState {
  alerts: Alert[];
  drivers: Driver[];
  vehicles: Vehicle[];
  pickupRecords: PickupRecord[];
  pendingTasks: number;
  complianceRate: number;
  todayPickups: { planned: number; completed: number };
  isLoadingDrivers: boolean;
  isLoadingVehicles: boolean;

  loadDrivers: (transportCompanyId?: string) => Promise<void>;
  loadVehicles: (transportCompanyId?: string) => Promise<void>;
  addDriver: (driver: CreateDriverInput) => Promise<void>;
  addVehicle: (vehicle: CreateVehicleInput) => Promise<void>;
  editDriver: (id: string, fields: Partial<Driver>) => Promise<void>;
  editVehicle: (id: string, fields: Partial<Vehicle>) => Promise<void>;

  // Alert actions (alerts remain local for Phase 1 — wired to real data in Phase 3)
  uploadDocument: (alertId: string, document: File) => void;
  sendMessage: (alertId: string, message: string) => void;
  assignAlternate: (alertId: string, driverId: string, vehicleId: string) => void;
  resolveAlert: (alertId: string) => void;

  getPickupRecords: () => PickupRecord[];
}

// Phase 1: alerts remain as representative mock data.
// Phase 3 will wire these to real events from pickup_events.
const mockAlerts: Alert[] = [
  {
    id: '1',
    type: 'warning',
    facility: 'مطعم النجمة',
    date: '2024-03-15',
    time: '10:00 ص',
    issue: 'رخصة السائق أحمد تنتهي خلال 30 يوماً',
    issueEn: "Driver Ahmed's license expires in 30 days",
    status: 'pending',
    priority: 'medium',
  },
  {
    id: '2',
    type: 'critical',
    facility: 'مستشفى الأمل',
    date: '2024-03-15',
    time: '11:00 ص',
    issue: 'المركبة مرخصة لنقل النفايات العامة فقط، وليست النفايات الطبية',
    issueEn: 'Vehicle licensed for general waste only, not medical waste',
    status: 'pending',
    priority: 'high',
  },
];

export const useTransportStore = create<TransportState>((set, get) => ({
  alerts: mockAlerts,
  drivers: [],
  vehicles: [],
  pickupRecords: [],
  pendingTasks: mockAlerts.filter((a) => a.status === 'pending').length,
  complianceRate: 87.5,
  todayPickups: { planned: 8, completed: 6 },
  isLoadingDrivers: false,
  isLoadingVehicles: false,

  loadDrivers: async (transportCompanyId?: string) => {
    set({ isLoadingDrivers: true });
    try {
      const drivers = await listDrivers(transportCompanyId);
      set({ drivers, isLoadingDrivers: false });
    } catch {
      set({ isLoadingDrivers: false });
    }
  },

  loadVehicles: async (transportCompanyId?: string) => {
    set({ isLoadingVehicles: true });
    try {
      const vehicles = await listVehicles(transportCompanyId);
      set({ vehicles, isLoadingVehicles: false });
    } catch {
      set({ isLoadingVehicles: false });
    }
  },

  editDriver: async (id, fields) => {
    const updated = await updateDriver(id, fields);
    set((s) => ({ drivers: s.drivers.map((d) => (d.id === id ? updated : d)) }));
  },

  editVehicle: async (id, fields) => {
    const updated = await updateVehicle(id, fields);
    set((s) => ({ vehicles: s.vehicles.map((v) => (v.id === id ? updated : v)) }));
  },

  addDriver: async (input: CreateDriverInput) => {
    const driver = await createDriver(input);
    set((state) => ({ drivers: [...state.drivers, driver] }));
    useNotificationStore.getState().addNotification({
      type: 'success',
      priority: 'low',
      title: 'تم إضافة السائق بنجاح',
      titleEn: 'Driver Added Successfully',
      message: `تم إضافة السائق ${driver.name_ar} إلى النظام`,
      messageEn: `Driver ${driver.name_ar} added to system`,
      role: 'transport',
      autoHide: true,
      duration: 4000,
    });
  },

  addVehicle: async (input: CreateVehicleInput) => {
    const vehicle = await createVehicle(input);
    set((state) => ({ vehicles: [...state.vehicles, vehicle] }));
    useNotificationStore.getState().addNotification({
      type: 'success',
      priority: 'low',
      title: 'تم إضافة المركبة بنجاح',
      titleEn: 'Vehicle Added Successfully',
      message: `تم إضافة المركبة ${vehicle.plate_number} إلى النظام`,
      messageEn: `Vehicle ${vehicle.plate_number} added to system`,
      role: 'transport',
      autoHide: true,
      duration: 4000,
    });
  },

  uploadDocument: (alertId: string, _document: File) => {
    set((state) => ({
      alerts: state.alerts.map((alert) =>
        alert.id === alertId ? { ...alert, status: 'corrected' as AlertStatus } : alert
      ),
    }));
    useNotificationStore.getState().addNotification({
      type: 'success',
      priority: 'medium',
      title: 'تم رفع الوثيقة بنجاح',
      titleEn: 'Document Uploaded Successfully',
      message: 'تم رفع الوثيقة وإرسالها للمراجعة',
      messageEn: 'Document uploaded and sent for review',
      role: 'transport',
      autoHide: true,
      duration: 5000,
    });
  },

  sendMessage: (alertId: string, message: string) => {
    console.log(`Message sent for alert ${alertId}: ${message}`);
  },

  assignAlternate: (alertId: string, _driverId: string, _vehicleId: string) => {
    set((state) => ({
      alerts: state.alerts.map((alert) =>
        alert.id === alertId ? { ...alert, status: 'corrected' as AlertStatus } : alert
      ),
    }));
  },

  resolveAlert: (alertId: string) => {
    set((state) => ({
      alerts: state.alerts.map((alert) =>
        alert.id === alertId ? { ...alert, status: 'resolved' as AlertStatus } : alert
      ),
    }));
  },

  getPickupRecords: () => get().pickupRecords,
}));
