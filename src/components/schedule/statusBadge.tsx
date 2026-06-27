import type { AssignmentStatus } from '../../lib/database.types';

interface StatusMeta {
  ar: string;
  en: string;
  /** Tailwind classes for the badge (background + text). */
  cls: string;
}

const STATUS_META: Record<AssignmentStatus, StatusMeta> = {
  pending:     { ar: 'قيد الانتظار', en: 'Pending',     cls: 'bg-yellow-100 text-yellow-800' },
  accepted:    { ar: 'مقبول',        en: 'Accepted',    cls: 'bg-blue-100 text-blue-800' },
  in_progress: { ar: 'قيد التنفيذ',  en: 'In Progress', cls: 'bg-orange-100 text-orange-800' },
  completed:   { ar: 'مكتمل',        en: 'Completed',   cls: 'bg-green-100 text-green-800' },
  cancelled:   { ar: 'ملغي',         en: 'Cancelled',   cls: 'bg-gray-200 text-gray-700' },
};

export function statusLabel(status: AssignmentStatus, isRTL: boolean): string {
  const meta = STATUS_META[status];
  return isRTL ? meta.ar : meta.en;
}

export function StatusBadge({ status, isRTL }: { status: AssignmentStatus; isRTL: boolean }) {
  const meta = STATUS_META[status];
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${meta.cls}`}>
      {isRTL ? meta.ar : meta.en}
    </span>
  );
}
