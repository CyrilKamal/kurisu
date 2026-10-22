/**
 * A show more than this many aired episodes behind is a backlog (One Piece at ep 0), not news:
 * Today lists it under "Catching up", and the count and the nav badge leave it out.
 */
export const KEEPING_UP_MAX = 3;

interface Behind {
  latestAired: number;
  episodesWatched: number;
}

/** Today's "Out for you" (new episodes of shows you keep up with) and "Catching up". */
export function splitOut<T extends Behind>(shows: T[]): { keepingUp: T[]; catchingUp: T[] } {
  const keepingUp = shows.filter((s) => s.latestAired - s.episodesWatched <= KEEPING_UP_MAX);
  const catchingUp = shows.filter((s) => s.latestAired - s.episodesWatched > KEEPING_UP_MAX);
  return { keepingUp, catchingUp };
}

/** The nav badge: "99+" past two digits, so it fits the bar and the rail. */
export function badgeCount(n: number): string {
  return n > 99 ? "99+" : String(n);
}
