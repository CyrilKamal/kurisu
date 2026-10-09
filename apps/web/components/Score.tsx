/** A 10-point score in mono, "8/10", or a faint "–/10" when there's none. */
export function Score({ score }: { score: number }) {
  if (score === 0) {
    return (
      <span className="k-score k-score--none" aria-label="Not scored">
        –<span className="k-score__of">/10</span>
      </span>
    );
  }
  return (
    <span className="k-score" aria-label={`Score ${String(score)} out of 10`}>
      {score}
      <span className="k-score__of">/10</span>
    </span>
  );
}
