import type { DropCategory, TasteGenre } from "@kurisu/shared";

export const DROP_CATEGORY_LABELS: Record<DropCategory, string> = {
  pacing: "Pacing",
  story: "Story",
  characters: "Characters",
  art_animation: "Art or animation",
  too_long: "Too long",
  lost_interest: "Lost interest",
  other: "Other",
};

/** How many genres each of the "higher" and "lower" lists shows. */
export const GENRES_SHOWN = 8;

/** Smaller differences than this (a twentieth of a point) count as neither higher nor lower. */
const MIN_AFFINITY = 0.05;

export interface TasteSections {
  /** Genres the user rates above their average, strongest first. */
  higher: TasteGenre[];
  /** Genres the user rates below their average, weakest first. */
  lower: TasteGenre[];
  /** Every genre with a score or a drop, best first. */
  all: TasteGenre[];
  /** The largest difference shown, for scaling the bars. */
  maxAffinity: number;
}

export function tasteSections(genres: TasteGenre[]): TasteSections {
  const scored = genres.filter((genre) => genre.scored > 0);
  const higher = scored
    .filter((genre) => genre.affinity >= MIN_AFFINITY)
    .sort((a, b) => b.affinity - a.affinity)
    .slice(0, GENRES_SHOWN);
  const lower = scored
    .filter((genre) => genre.affinity <= -MIN_AFFINITY)
    .sort((a, b) => a.affinity - b.affinity)
    .slice(0, GENRES_SHOWN);
  const all = genres
    .filter((genre) => genre.scored > 0 || genre.dropped > 0)
    .sort((a, b) => b.affinity - a.affinity || b.scored - a.scored);
  const maxAffinity = Math.max(
    0,
    ...[...higher, ...lower].map((genre) => Math.abs(genre.affinity)),
  );
  return { higher, lower, all, maxAffinity };
}

/** "+0.8", "−0.7", or "0.0" for a difference too small to matter. */
export function formatAffinity(affinity: number): string {
  if (Math.abs(affinity) < MIN_AFFINITY) return "0.0";
  return `${affinity > 0 ? "+" : "−"}${Math.abs(affinity).toFixed(1)}`;
}

/** "8.4", or "–" when nothing is scored. */
export function formatScore(score: number | null): string {
  return score === null ? "–" : score.toFixed(1);
}
