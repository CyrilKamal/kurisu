import type { ScoreStyle } from "@kurisu/shared";

/**
 * A MAL score (1–10) in the user's style: "8" on 10 points, "80" on 100, "★★★★" in stars (a 7
 * is "★★★½"). Every style maps exactly onto MAL's scale, so no score changes.
 */
export function scoreText(score: number, style: ScoreStyle): string {
  if (style === "point_100") return String(score * 10);
  if (style === "stars_5")
    return `${"★".repeat(Math.floor(score / 2))}${score % 2 === 1 ? "½" : ""}`;
  return String(score);
}

/** What a score is out of, shown after it: "/10", "/100", or nothing for stars. */
export function scoreScale(style: ScoreStyle): string {
  return style === "point_100" ? "/100" : style === "stars_5" ? "" : "/10";
}

/** A score in words, for assistive tech: "8 out of 10", "80 out of 100", "3.5 stars". */
export function scoreSpoken(score: number, style: ScoreStyle): string {
  if (style === "point_100") return `${String(score * 10)} out of 100`;
  if (style === "stars_5") {
    const stars = score / 2;
    return `${String(stars)} ${stars === 1 ? "star" : "stars"}`;
  }
  return `${String(score)} out of 10`;
}

/** A score picker's choices, best first, each saving MAL's 1–10. */
export function scoreOptions(style: ScoreStyle): { value: number; label: string }[] {
  return [10, 9, 8, 7, 6, 5, 4, 3, 2, 1].map((value) => ({
    value,
    label: scoreText(value, style),
  }));
}

/** A score under a narrow chart column: "8", "80", or "4" and "3½" (stars). */
export function scoreAxisLabel(score: number, style: ScoreStyle): string {
  if (style === "stars_5") {
    const whole = Math.floor(score / 2);
    return score % 2 === 1 ? `${whole === 0 ? "" : String(whole)}½` : String(whole);
  }
  return scoreText(score, style);
}

/** A mean of MAL scores (1–10) in the user's style: "7.84", "78.4" or "3.92". */
export function meanText(mean: number, style: ScoreStyle): string {
  if (style === "point_100") return (mean * 10).toFixed(1);
  if (style === "stars_5") return (mean / 2).toFixed(2);
  return mean.toFixed(2);
}
