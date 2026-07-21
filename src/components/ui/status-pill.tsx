import { CheckCircle2Icon, AlertTriangleIcon, XCircleIcon, ClockIcon } from 'lucide-react';
import type { ComplianceStatus } from '@/lib/database.types';

/**
 * THE compliance status visual (design system): one pill, icon + label,
 * used identically by dashboard, pickup log, review queue and recent lists.
 * One lexicon: ممتثل / تحذير / غير ممتثل.
 */
const TONES: Record<ComplianceStatus, {
  ar: string; en: string;
  cls: string;
  Icon: typeof CheckCircle2Icon;
}> = {
  compliant: {
    ar: 'ممتثل', en: 'Compliant',
    cls: 'bg-success/10 text-success border-success/30',
    Icon: CheckCircle2Icon,
  },
  warning: {
    ar: 'تحذير', en: 'Warning',
    cls: 'bg-warning/10 text-warning border-warning/40',
    Icon: AlertTriangleIcon,
  },
  non_compliant: {
    ar: 'غير ممتثل', en: 'Non-Compliant',
    cls: 'bg-destructive/10 text-destructive border-destructive/30',
    Icon: XCircleIcon,
  },
  // (CP5/030) A pickup awaiting a required branch-operator confirmation —
  // its own distinct state, never compliant, never folded into
  // non_compliant (that would misreport a policy-in-progress case as a
  // violation before the window has even had a chance to elapse).
  pending_confirmation: {
    ar: 'بانتظار تأكيد الفرع', en: 'Pending Confirmation',
    cls: 'bg-secondary/10 text-secondary border-secondary/30',
    Icon: ClockIcon,
  },
};

export function StatusPill({
  status,
  isRTL,
  size = 'md',
}: {
  status: ComplianceStatus;
  isRTL: boolean;
  size?: 'sm' | 'md';
}) {
  const tone = TONES[status] ?? TONES.non_compliant;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border font-semibold ${
        size === 'sm' ? 'px-2 py-0.5 text-[11px]' : 'px-3 py-1 text-xs'
      } ${tone.cls}`}
    >
      <tone.Icon className={size === 'sm' ? 'w-3 h-3' : 'w-3.5 h-3.5'} aria-hidden />
      {isRTL ? tone.ar : tone.en}
    </span>
  );
}
