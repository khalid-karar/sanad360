/**
 * Compact risk-score arc (0–100). The product's signature visual for risk:
 * green ≤ 0, amber ≤ 39, red above — mirroring the server-side thresholds.
 * Numbers stay Latin digits (design-system digit policy).
 *
 * `complianceStatus`, when passed, overrides that score-only coloring: CP3
 * (migration 022) can force compliance_status='non_compliant' purely because
 * a policy-required evidence item is missing, independent of risk_score — a
 * record can be score=0 and still non_compliant. Without this override the
 * gauge would render plain green for that case, reading as "fine" when it
 * is in fact a policy violation. CP5 (migration 030) adds
 * 'pending_confirmation' — a pickup awaiting a required branch confirmation
 * — which gets its own color too, for the same reason: a score=0 pending
 * pickup must not read as "fine" (green) OR as "violation" (red) before the
 * confirmation window has even had a chance to resolve.
 */
export function RiskGauge({
  score,
  size = 44,
  complianceStatus,
}: {
  score: number;
  size?: number;
  complianceStatus?: 'compliant' | 'warning' | 'non_compliant' | 'pending_confirmation';
}) {
  const clamped = Math.max(0, Math.min(100, score));
  const color =
    complianceStatus === 'pending_confirmation' ? 'hsl(var(--secondary))'
    : complianceStatus === 'non_compliant' ? 'hsl(var(--destructive))'
    : clamped === 0 ? 'hsl(var(--success))'
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
