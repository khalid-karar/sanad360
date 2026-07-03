import { useMemo, useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { Button } from '@/components/ui/button';
import { CalendarIcon, ChevronRightIcon, ChevronLeftIcon, XIcon } from 'lucide-react';

/**
 * Bilingual date picker (design system) — replaces native <input type="date">,
 * whose mm/dd/yyyy chrome ignored the app's language entirely (UX P2-2).
 *
 * Zero new dependencies: Radix Popover (already installed) + a plain month
 * grid. Follows the app formatting policy (src/lib/format.ts): Gregorian
 * calendar, Latin digits, localized month/weekday names. Fully RTL-aware —
 * the nav chevrons use logical direction.
 *
 * Value contract matches the native input it replaces: 'YYYY-MM-DD' or ''.
 */

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function toValue(y: number, m: number, d: number): string {
  return `${y}-${pad(m + 1)}-${pad(d)}`;
}

export function DatePicker({
  value,
  onChange,
  isRTL,
  placeholder,
}: {
  value: string; // 'YYYY-MM-DD' or ''
  onChange: (v: string) => void;
  isRTL: boolean;
  placeholder?: string;
}) {
  const today = new Date();
  const selected = value ? new Date(`${value}T00:00:00`) : null;
  const [open, setOpen] = useState(false);
  const [viewYear, setViewYear] = useState(selected?.getFullYear() ?? today.getFullYear());
  const [viewMonth, setViewMonth] = useState(selected?.getMonth() ?? today.getMonth());

  const locale = isRTL ? 'ar-SA-u-ca-gregory-nu-latn' : 'en-GB';

  const monthLabel = useMemo(
    () =>
      new Date(viewYear, viewMonth, 1).toLocaleDateString(locale, {
        month: 'long',
        year: 'numeric',
      }),
    [viewYear, viewMonth, locale]
  );

  // Localized weekday header, week starting Sunday (KSA convention).
  const weekdays = useMemo(() => {
    const base = new Date(Date.UTC(2023, 0, 1)); // a Sunday
    return Array.from({ length: 7 }, (_, i) =>
      new Date(base.getTime() + i * 86400000).toLocaleDateString(locale, { weekday: 'narrow' })
    );
  }, [locale]);

  const grid = useMemo(() => {
    const firstDay = new Date(viewYear, viewMonth, 1).getDay(); // 0 = Sunday
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    const cells: (number | null)[] = Array(firstDay).fill(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(d);
    return cells;
  }, [viewYear, viewMonth]);

  function shiftMonth(delta: number) {
    const next = new Date(viewYear, viewMonth + delta, 1);
    setViewYear(next.getFullYear());
    setViewMonth(next.getMonth());
  }

  const display = selected
    ? selected.toLocaleDateString(locale, { year: 'numeric', month: '2-digit', day: '2-digit' })
    : (placeholder ?? (isRTL ? 'اختر تاريخاً' : 'Pick a date'));

  const PrevIcon = isRTL ? ChevronRightIcon : ChevronLeftIcon;
  const NextIcon = isRTL ? ChevronLeftIcon : ChevronRightIcon;

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <Button
          type="button"
          variant="outline"
          className={`w-full justify-between bg-background text-foreground border-input font-normal ${
            !selected ? 'text-muted-foreground' : ''
          }`}
        >
          <span className="flex items-center gap-2">
            <CalendarIcon className="w-4 h-4 text-muted-foreground" aria-hidden />
            <span dir="ltr">{display}</span>
          </span>
          {selected && (
            <XIcon
              className="w-3.5 h-3.5 text-muted-foreground hover:text-foreground"
              aria-label={isRTL ? 'مسح التاريخ' : 'Clear date'}
              onClick={(e) => {
                e.stopPropagation();
                onChange('');
              }}
            />
          )}
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          dir={isRTL ? 'rtl' : 'ltr'}
          sideOffset={6}
          className="z-50 rounded-xl border border-border bg-card text-card-foreground p-3 shadow-medium w-72"
        >
          <div className="flex items-center justify-between mb-2">
            <Button type="button" variant="ghost" size="icon-sm" onClick={() => shiftMonth(-1)} aria-label={isRTL ? 'الشهر السابق' : 'Previous month'}>
              <PrevIcon className="w-4 h-4" />
            </Button>
            <span className="text-sm font-semibold">{monthLabel}</span>
            <Button type="button" variant="ghost" size="icon-sm" onClick={() => shiftMonth(1)} aria-label={isRTL ? 'الشهر التالي' : 'Next month'}>
              <NextIcon className="w-4 h-4" />
            </Button>
          </div>
          <div className="grid grid-cols-7 gap-0.5 text-center">
            {weekdays.map((w, i) => (
              <span key={i} className="text-[11px] text-muted-foreground py-1">{w}</span>
            ))}
            {grid.map((d, i) =>
              d === null ? (
                <span key={`e${i}`} />
              ) : (
                <button
                  key={d}
                  type="button"
                  onClick={() => {
                    onChange(toValue(viewYear, viewMonth, d));
                    setOpen(false);
                  }}
                  className={`h-8 w-8 mx-auto rounded-md text-sm tabular-nums hover:bg-accent hover:text-accent-foreground ${
                    value === toValue(viewYear, viewMonth, d)
                      ? 'bg-primary text-primary-foreground font-semibold'
                      : 'text-foreground'
                  }`}
                >
                  <span dir="ltr">{d}</span>
                </button>
              )
            )}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
