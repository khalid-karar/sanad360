import { CheckCircle2Icon, AlertTriangleIcon, XCircleIcon, ClockIcon } from 'lucide-react';
import type { ComplianceStatus } from '@/lib/database.types';

/**
 * THE compliance status visual (design system): one pill, icon + label,
 * used identically by dashboard, pickup log, review queue and recent lists.
 * One lexicon: ممتثل / تحذير / غير ممتثل.
 */
// CP7: text colors below are pinned to explicit HSL values (not the plain
// text-success/text-warning/etc utility classes) because the actual
// rendered pairing is small (text-xs/11px) solid tone-text on a *10%-opacity*
// tone background composited over --card — a different, lower-contrast pair
// than the shared --success/--warning/etc tokens are verified for elsewhere
// (solid button fills, badges). Computed via the WCAG relative-luminance
// formula against the true composited background in both themes; four of
// the eight theme/tone combinations failed 4.5:1 at this size using the
// shared token's default lightness:
//   light warning 4.34, light non_compliant 4.11, dark compliant 2.99,
//   dark non_compliant 4.30, dark pending_confirmation 2.23 — all now >=5.0.
// Deliberately NOT changing the shared --success/--warning/--destructive/
// --secondary tokens themselves: those already have separately-verified
// pairings elsewhere (button fills, badges) that a global lightness change
// would risk breaking.
const TONES: Record<ComplianceStatus, {
  ar: string; en: string;
  cls: string;
  Icon: typeof CheckCircle2Icon;
}> = {
  compliant: {
    ar: 'ممتثل', en: 'Compliant',
    cls: 'bg-success/10 text-[hsl(150_65%_26%)] dark:text-[hsl(150_65%_37%)] border-success/30',
    Icon: CheckCircle2Icon,
  },
  warning: {
    ar: 'تحذير', en: 'Warning',
    cls: 'bg-warning/10 text-[hsl(35_92%_30%)] dark:text-[hsl(38_92%_50%)] border-warning/40',
    Icon: AlertTriangleIcon,
  },
  non_compliant: {
    ar: 'غير ممتثل', en: 'Non-Compliant',
    cls: 'bg-destructive/10 text-[hsl(0_72%_44%)] dark:text-[hsl(0_72%_61%)] border-destructive/30',
    Icon: XCircleIcon,
  },
  // (CP5/030) A pickup awaiting a required branch-operator confirmation —
  // its own distinct state, never compliant, never folded into
  // non_compliant (that would misreport a policy-in-progress case as a
  // violation before the window has even had a chance to elapse).
  pending_confirmation: {
    ar: 'بانتظار تأكيد الفرع', en: 'Pending Confirmation',
    cls: 'bg-secondary/10 text-[hsl(225_70%_40%)] dark:text-[hsl(225_70%_64%)] border-secondary/30',
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
