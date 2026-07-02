import { useAuthStore } from '../../stores/authStore';
import type { PickupState } from '../../stores/driverStore';

// Ordered field-flow steps (awaiting is the list view, not a step).
const STEPS: { key: PickupState; ar: string; en: string }[] = [
  { key: 'qr-scan',              ar: 'رمز QR',   en: 'QR' },
  { key: 'geolocation-verified', ar: 'الموقع',   en: 'Location' },
  { key: 'manifest',             ar: 'البيان',   en: 'Manifest' },
  { key: 'signature',            ar: 'التوقيع',  en: 'Signature' },
  { key: 'confirmation',         ar: 'الحفظ',    en: 'Save' },
];

/**
 * Bilingual progress indicator for the 5-step evidence flow. Field context:
 * glanceable "step N of M" + dots, high contrast, no motion.
 */
export default function FlowStepper({ current }: { current: PickupState }) {
  const { isRTL } = useAuthStore();
  const idx = STEPS.findIndex((s) => s.key === current);
  if (idx === -1) return null;
  const step = STEPS[idx];

  return (
    <div
      className="max-w-2xl mx-auto mb-4 flex items-center justify-between gap-3"
      role="progressbar"
      aria-valuemin={1}
      aria-valuemax={STEPS.length}
      aria-valuenow={idx + 1}
      aria-label={isRTL ? `الخطوة ${idx + 1} من ${STEPS.length}` : `Step ${idx + 1} of ${STEPS.length}`}
    >
      <span className="text-sm font-semibold text-foreground whitespace-nowrap">
        {isRTL
          ? `الخطوة ${idx + 1} من ${STEPS.length} — ${step.ar}`
          : `Step ${idx + 1} of ${STEPS.length} — ${step.en}`}
      </span>
      <div className="flex items-center gap-1.5" aria-hidden>
        {STEPS.map((s, i) => (
          <span
            key={s.key}
            className={`h-2 rounded-full transition-none ${
              i < idx ? 'w-2 bg-primary/50' : i === idx ? 'w-6 bg-primary' : 'w-2 bg-border'
            }`}
          />
        ))}
      </div>
    </div>
  );
}
