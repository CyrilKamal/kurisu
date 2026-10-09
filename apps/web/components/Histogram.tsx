export interface HistogramColumn {
  /** Under the column: "8", "M". */
  label: string;
  value: number;
  /** For the table: "Score 8", "March". */
  name: string;
}

/**
 * Columns of counts (the design system's ScoreHistogram): square bars with their count above,
 * mono labels, the most common one in crimson, and the mean as a dashed line when given (the
 * 1–10 score scale only). A table under it lists every value.
 */
export function Histogram({
  columns,
  summary,
  modeIndex = null,
  mean = null,
}: {
  columns: HistogramColumn[];
  /** The chart in one sentence, for assistive tech: "Score distribution; most often 8". */
  summary: string;
  modeIndex?: number | null;
  /** The mean on a 1–10 scale; only for ten score columns. */
  mean?: number | null;
}) {
  const max = Math.max(1, ...columns.map((c) => c.value));
  return (
    <figure className="m-0">
      <div
        className="k-hist"
        role="img"
        aria-label={summary}
        style={
          columns.length === 10
            ? undefined
            : { gridTemplateColumns: `repeat(${String(columns.length)}, 1fr)` }
        }
      >
        {columns.map((column, i) => (
          <div
            key={column.name}
            className={i === modeIndex ? "k-hist__col is-mode" : "k-hist__col"}
          >
            <span
              className="k-hist__bar"
              style={{ "--h": `${String((column.value / max) * 100)}%` } as React.CSSProperties}
              {...(column.value > 0 && { "data-n": column.value })}
            />
            <span className="k-hist__label">{column.label}</span>
          </div>
        ))}
        {mean !== null && columns.length === 10 && (
          <span className="k-hist__mean" style={{ "--m": mean } as React.CSSProperties}>
            <span>avg {mean.toFixed(1)}</span>
          </span>
        )}
      </div>
      <details className="k-trace mt-2 font-sans tabular-nums">
        <summary>Show as a table</summary>
        <table className="k-mono mt-2">
          <tbody>
            {columns.map((column) => (
              <tr key={column.name}>
                <td className="pr-4 text-ink-muted">{column.name}</td>
                <td className="text-right text-ink">{column.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}

/** The index of the largest count, or null when every count is 0. */
export function modeOf(values: number[]): number | null {
  let best: number | null = null;
  values.forEach((value, i) => {
    if (value > 0 && (best === null || value > (values[best] ?? 0))) best = i;
  });
  return best;
}
