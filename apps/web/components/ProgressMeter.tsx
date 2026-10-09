/**
 * How far through a show someone is (the design system's ProgressMeter): a 4px crimson bar,
 * always with its mono readout. With no known total there's no bar, only the episode.
 */
export function ProgressMeter({
  watched,
  total,
  bar = true,
  className,
}: {
  watched: number;
  total: number | null;
  /** False for the readout alone, as for a completed show. */
  bar?: boolean;
  className?: string;
}) {
  if (total === null) {
    return (
      <span className="k-meter__label">
        ep <b>{watched}</b>
      </span>
    );
  }
  const readout = (
    <span className="k-meter__label">
      <b>{watched}</b>/{total}
    </span>
  );
  if (!bar) return readout;
  const share = `${String(Math.round(Math.min(watched / total, 1) * 100))}%`;
  return (
    <div
      className={className ? `k-meter ${className}` : "k-meter"}
      role="img"
      aria-label={`${String(watched)} of ${String(total)} episodes watched`}
    >
      <div className="k-meter__track">
        <div className="k-meter__fill" style={{ "--p": share } as React.CSSProperties} />
      </div>
      {readout}
    </div>
  );
}
