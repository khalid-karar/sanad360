import { useMemo, useRef, useState } from 'react';
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

/**
 * Bilingual date+time picker — replaces native <input type="datetime-local">,
 * whose typed field order (mm/dd vs dd/mm) follows the BROWSER's OS locale,
 * not the app's language, and can't be forced via HTML/CSS. This gives full
 * control: a calendar to pick from (reuses DatePicker's month-grid), and — if
 * the user types instead — a fixed field order of day, then month, then
 * year, then hour, then minute, regardless of browser/OS locale.
 *
 * Value contract matches the native input it replaces: 'YYYY-MM-DDTHH:mm' or
 * '' (so `new Date(value).toISOString()` at call sites keeps working
 * unchanged).
 */

interface DateTimeParts {
  day: string;
  month: string;
  year: string;
  hour: string;
  minute: string;
}

function parseDateTimeValue(value: string): DateTimeParts {
  if (!value) return { day: '', month: '', year: '', hour: '', minute: '' };
  const [datePart, timePart] = value.split('T');
  const [y, m, d] = (datePart ?? '').split('-');
  const [h, mi] = (timePart ?? '').split(':');
  return { day: d ?? '', month: m ?? '', year: y ?? '', hour: h ?? '', minute: mi ?? '' };
}

function partsToDateTimeValue(p: DateTimeParts): string {
  if (!p.day || !p.month || !p.year || p.year.length < 4 || !p.hour || !p.minute) return '';
  const day = Number(p.day);
  const month = Number(p.month);
  const hour = Number(p.hour);
  const minute = Number(p.minute);
  if (day < 1 || day > 31 || month < 1 || month > 12 || hour > 23 || minute > 59) return '';
  return `${p.year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}`;
}

type SegmentKey = keyof DateTimeParts;
const SEGMENTS: { key: SegmentKey; maxLen: number; max: number }[] = [
  { key: 'day', maxLen: 2, max: 31 },
  { key: 'month', maxLen: 2, max: 12 },
  { key: 'year', maxLen: 4, max: 9999 },
  { key: 'hour', maxLen: 2, max: 23 },
  { key: 'minute', maxLen: 2, max: 59 },
];

export function DateTimePicker({
  value,
  onChange,
  isRTL,
}: {
  value: string; // 'YYYY-MM-DDTHH:mm' or ''
  onChange: (v: string) => void;
  isRTL: boolean;
}) {
  const today = new Date();
  const parts = parseDateTimeValue(value);
  const selected = value ? new Date(value) : null;

  const [open, setOpen] = useState(false);
  const [viewYear, setViewYear] = useState(selected?.getFullYear() ?? today.getFullYear());
  const [viewMonth, setViewMonth] = useState(selected?.getMonth() ?? today.getMonth());
  const inputRefs = useRef<Record<SegmentKey, HTMLInputElement | null>>({
    day: null, month: null, year: null, hour: null, minute: null,
  });

  const locale = isRTL ? 'ar-SA-u-ca-gregory-nu-latn' : 'en-GB';

  const monthLabel = useMemo(
    () => new Date(viewYear, viewMonth, 1).toLocaleDateString(locale, { month: 'long', year: 'numeric' }),
    [viewYear, viewMonth, locale]
  );

  const weekdays = useMemo(() => {
    const base = new Date(Date.UTC(2023, 0, 1)); // a Sunday
    return Array.from({ length: 7 }, (_, i) =>
      new Date(base.getTime() + i * 86400000).toLocaleDateString(locale, { weekday: 'narrow' })
    );
  }, [locale]);

  const grid = useMemo(() => {
    const firstDay = new Date(viewYear, viewMonth, 1).getDay();
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

  function commit(next: DateTimeParts) {
    onChange(partsToDateTimeValue(next));
  }

  function setSegment(key: SegmentKey, raw: string) {
    const digits = raw.replace(/\D/g, '');
    const meta = SEGMENTS.find((s) => s.key === key)!;
    const clipped = digits.slice(0, meta.maxLen);
    const next = { ...parts, [key]: clipped };
    commit(next);

    // Auto-advance to the next field once this one is full, or once a
    // second keystroke would obviously overflow it (e.g. day "4" -> next
    // digit can only make 40-49, always > 31, so advance right away).
    const numeric = Number(clipped || '0');
    const filled = clipped.length === meta.maxLen;
    const overflowsNextDigit = meta.maxLen === 2 && clipped.length === 1 && numeric * 10 > meta.max;
    if (filled || overflowsNextDigit) {
      const idx = SEGMENTS.findIndex((s) => s.key === key);
      const nextSegment = SEGMENTS[idx + 1];
      if (nextSegment) inputRefs.current[nextSegment.key]?.focus();
    }
  }

  function handleKeyDown(key: SegmentKey, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Backspace' && parts[key] === '') {
      const idx = SEGMENTS.findIndex((s) => s.key === key);
      const prevSegment = SEGMENTS[idx - 1];
      if (prevSegment) inputRefs.current[prevSegment.key]?.focus();
    }
  }

  function pickDay(d: number) {
    const next: DateTimeParts = {
      ...parts,
      day: pad(d),
      month: pad(viewMonth + 1),
      year: String(viewYear),
      hour: parts.hour || '00',
      minute: parts.minute || '00',
    };
    commit(next);
    setOpen(false);
  }

  const PrevIcon = isRTL ? ChevronRightIcon : ChevronLeftIcon;
  const NextIcon = isRTL ? ChevronLeftIcon : ChevronRightIcon;

  const segmentInput = (key: SegmentKey, placeholder: string, widthCls: string) => (
    <input
      key={key}
      ref={(el) => { inputRefs.current[key] = el; }}
      type="text"
      inputMode="numeric"
      value={parts[key]}
      placeholder={placeholder}
      onChange={(e) => setSegment(key, e.target.value)}
      onKeyDown={(e) => handleKeyDown(key, e)}
      className={`${widthCls} bg-transparent text-foreground text-center tabular-nums outline-none placeholder:text-muted-foreground`}
      aria-label={isRTL
        ? { day: 'اليوم', month: 'الشهر', year: 'السنة', hour: 'الساعة', minute: 'الدقيقة' }[key]
        : { day: 'Day', month: 'Month', year: 'Year', hour: 'Hour', minute: 'Minute' }[key]}
    />
  );

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      {/* Fixed day/month/year/hour/minute order, independent of RTL layout —
          this is a numeric field, not prose, so it never mirrors. */}
      <div
        dir="ltr"
        className="flex items-center gap-1 w-full border border-input rounded-md px-2 py-2 bg-background text-sm focus-within:ring-1 focus-within:ring-ring"
      >
        {segmentInput('day', 'DD', 'w-6')}
        <span className="text-muted-foreground">/</span>
        {segmentInput('month', 'MM', 'w-6')}
        <span className="text-muted-foreground">/</span>
        {segmentInput('year', 'YYYY', 'w-11')}
        <span className="text-muted-foreground mx-1">·</span>
        {segmentInput('hour', 'HH', 'w-6')}
        <span className="text-muted-foreground">:</span>
        {segmentInput('minute', 'MM', 'w-6')}
        <Popover.Trigger asChild>
          <button
            type="button"
            className="ms-auto p-1 text-muted-foreground hover:text-foreground"
            aria-label={isRTL ? 'اختر من التقويم' : 'Pick from calendar'}
          >
            <CalendarIcon className="w-4 h-4" />
          </button>
        </Popover.Trigger>
      </div>
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
                  onClick={() => pickDay(d)}
                  className={`h-8 w-8 mx-auto rounded-md text-sm tabular-nums hover:bg-accent hover:text-accent-foreground ${
                    parts.day === pad(d) && parts.month === pad(viewMonth + 1) && parts.year === String(viewYear)
                      ? 'bg-primary text-primary-foreground font-semibold'
                      : 'text-foreground'
                  }`}
                >
                  <span dir="ltr">{d}</span>
                </button>
              )
            )}
          </div>
          <p className="text-[11px] text-muted-foreground mt-2 text-center">
            {isRTL ? 'اليوم / الشهر / السنة · الساعة : الدقيقة' : 'Day / Month / Year · Hour : Minute'}
          </p>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
