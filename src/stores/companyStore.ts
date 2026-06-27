import { create } from 'zustand';
import { useNotificationStore } from './notificationStore';
import { listPickups } from '../lib/api/pickups';
import { getDashboardKpis, type DashboardKpis } from '../lib/api/analytics';
import type { PickupEvent } from '../lib/database.types';

export interface ComplianceIssue {
  id: string;
  type: 'warning' | 'error';
  titleAr: string;
  titleEn: string;
  descriptionAr: string;
  descriptionEn: string;
}

export interface ComplianceData {
  date: string;
  percentage: number;
  status: 'pending' | 'approved' | 'submitted';
  level?: 'green' | 'yellow' | 'red';
  issues: ComplianceIssue[];
}

export interface RecentPickup {
  id: string;
  date: string;
  wasteType: string;
  weight: string;
  driver: string;   // driver_id for now; Phase 3 joins to name
  complianceStatus: 'compliant' | 'warning' | 'non_compliant';
  riskScore: number;
  branchId: string;
  companyId: string;
}

interface CompanyState {
  complianceData: ComplianceData;
  recentPickups: RecentPickup[];
  isLoadingPickups: boolean;
  kpis: DashboardKpis | null;
  isLoadingKpis: boolean;

  loadKpis: (companyId: string) => Promise<void>;
  loadRecentPickups: () => Promise<void>;
  approveCompliance: () => void;
  overrideAndApprove: () => void;
  requestCorrection: (issueId: string) => void;
  alertTransporter: () => void;
}

function pickupEventToRecentPickup(event: PickupEvent): RecentPickup {
  return {
    id: event.id,
    date: new Date(event.created_at).toLocaleDateString('ar-SA'),
    wasteType: event.waste_types.join('، '),
    weight: `${event.weight_kg} كجم`,
    driver: event.driver_id,  // Phase 3: join to drivers.name_ar
    complianceStatus: event.compliance_status,
    riskScore: event.risk_score,
    branchId: event.branch_id,
    companyId: event.company_id,
  };
}

function levelFromRate(rate: number): 'green' | 'yellow' | 'red' {
  if (rate >= 95) return 'green';
  if (rate >= 80) return 'yellow';
  return 'red';
}

export const useCompanyStore = create<CompanyState>((set) => ({
  complianceData: {
    date: new Date().toLocaleDateString('ar-SA'),
    percentage: 0,
    status: 'pending',
    level: 'green',
    issues: [],
  },
  recentPickups: [],
  isLoadingPickups: false,
  kpis: null,
  isLoadingKpis: false,

  loadKpis: async (companyId: string) => {
    set({ isLoadingKpis: true });
    try {
      const kpis = await getDashboardKpis(companyId);
      set({
        kpis,
        isLoadingKpis: false,
        complianceData: {
          date: new Date().toLocaleDateString('ar-SA'),
          percentage: kpis.complianceRate,
          status: 'pending',
          level: levelFromRate(kpis.complianceRate),
          issues: [],
        },
      });
    } catch {
      set({ isLoadingKpis: false });
    }
  },

  loadRecentPickups: async () => {
    set({ isLoadingPickups: true });
    try {
      const events = await listPickups({ limit: 10 });
      set({
        recentPickups: events.map(pickupEventToRecentPickup),
        isLoadingPickups: false,
      });
    } catch {
      set({ isLoadingPickups: false });
    }
  },

  approveCompliance: () => {
    set((state) => ({
      complianceData: { ...state.complianceData, status: 'submitted' },
    }));
    useNotificationStore.getState().addNotification({
      type: 'success',
      priority: 'medium',
      title: 'تم إرسال بيان الامتثال',
      titleEn: 'Compliance Manifest Submitted',
      message: 'تم إرسال بيان الامتثال بنجاح إلى NCWM',
      messageEn: 'Compliance manifest successfully submitted to NCWM',
      role: 'company',
      autoHide: true,
      duration: 5000,
    });
  },

  overrideAndApprove: () => {
    set((state) => ({
      complianceData: { ...state.complianceData, status: 'submitted' },
    }));
    useNotificationStore.getState().addNotification({
      type: 'warning',
      priority: 'medium',
      title: 'تم تجاهل التحذيرات والموافقة',
      titleEn: 'Warnings Overridden and Approved',
      message: 'تم إرسال البيان مع تجاهل التحذيرات',
      messageEn: 'Manifest submitted with warnings overridden',
      role: 'company',
      autoHide: true,
      duration: 7000,
    });
  },

  requestCorrection: (_issueId: string) => {
    useNotificationStore.getState().addNotification({
      type: 'info',
      priority: 'medium',
      title: 'تم طلب التصحيح',
      titleEn: 'Correction Requested',
      message: 'تم إرسال طلب التصحيح إلى شركة النقل',
      messageEn: 'Correction request sent to transport company',
      role: 'company',
      autoHide: true,
      duration: 5000,
    });
  },

  alertTransporter: () => {
    useNotificationStore.getState().addNotification({
      type: 'error',
      priority: 'high',
      title: 'تم إبلاغ شركة النقل',
      titleEn: 'Transport Company Alerted',
      message: 'تم إرسال تنبيه حرج إلى شركة النقل لحل المشاكل',
      messageEn: 'Critical alert sent to transport company to resolve issues',
      role: 'company',
      autoHide: true,
      duration: 8000,
    });
  },
}));
