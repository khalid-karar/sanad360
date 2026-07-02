/**
 * Compact risk-score arc (0–100). The product's signature visual for risk:
 * green ≤ 0, amber ≤ 39, red above — mirroring the server-side thresholds.
 * Numbers stay Latin digits (design-system digit policy).
 */
export function RiskGauge({ score, size = 44 }: { score: number; size?: number }) {
  const clamped = Math.max(0, Math.min(100, score));
  const color =
    clamped === 0 ? 'hsl(var(--success))'
    : clamped <= 39 ? 'hsl(var(--warning))'
    : 'hsl(var(--destructive))';

  const stroke = 4;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const filled = (clamped / 100) * c;

  return (
    <span
      className="relative inline-flex items-center justify-center flex-shrink-0"
      style={{ width: size, height: size }}
      role="img"
      aria-label={`Risk ${clamped}/100`}
      title={`${clamped}/100`}
    >
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none"
          stroke="hsl(var(--border))" strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none"
          stroke={color} strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={`${filled} ${c - filled}`} />
      </svg>
      <span dir="ltr" className="absolute text-[11px] font-bold text-foreground tabular-nums">
        {clamped}
      </span>
    </span>
  );
}
