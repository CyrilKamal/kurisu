"use client";

import { scoreScale, scoreSpoken, scoreText } from "@/lib/score";

import { useScoreStyle } from "./ScoreStyle";

/**
 * A score in the user's style (Settings): "8/10", "80/100" or "★★★★", in mono, or a faint "–"
 * when there's none. The score itself is always MAL's 1–10.
 */
export function Score({ score }: { score: number }) {
  const style = useScoreStyle();
  const scale = scoreScale(style);
  if (score === 0) {
    return (
      <span className="k-score k-score--none" aria-label="Not scored">
        –{scale && <span className="k-score__of">{scale}</span>}
      </span>
    );
  }
  return (
    <span className="k-score" aria-label={`Score ${scoreSpoken(score, style)}`}>
      {scoreText(score, style)}
      {scale && <span className="k-score__of">{scale}</span>}
    </span>
  );
}
