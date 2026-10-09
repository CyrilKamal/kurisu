/**
 * A strip of metrics in one hairline panel (the design system's StatTile): an uppercase label,
 * a mono value with its unit small beside it, and what it's computed from. One hero per screen.
 */
export function Metrics({ children }: { children: React.ReactNode }) {
  return <div className="k-metrics">{children}</div>;
}

export function Metric({
  label,
  value,
  unit,
  basis,
  hero = false,
}: {
  label: string;
  value: string;
  unit?: string;
  /** What it's computed from: "across 184 scored shows". */
  basis?: string;
  hero?: boolean;
}) {
  return (
    <div className={hero ? "k-metric k-metric--hero" : "k-metric"}>
      <p className="k-caps">{label}</p>
      <p className="k-metric__value">
        {value}
        {unit && <small>{unit}</small>}
      </p>
      {basis && <p className="k-metric__label">{basis}</p>}
    </div>
  );
}
