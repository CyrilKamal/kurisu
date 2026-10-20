import type { FavoriteShow } from "@kurisu/shared";

/** Moves one favorite up (-1) or down (1) a place; at either end nothing moves. */
export function moved(shows: FavoriteShow[], index: number, by: -1 | 1): FavoriteShow[] {
  const to = index + by;
  if (to < 0 || to >= shows.length) return shows;
  const next = [...shows];
  const [show] = next.splice(index, 1);
  if (show) next.splice(to, 0, show);
  return next;
}
