import type { AiringView, ListStatus } from "@kurisu/shared";

const MINUTE_MS = 60_000;

/**
 * How long until an episode airs, in the two largest units ("2d 4h", "5h 20m", "12m"), as the
 * design system's AiringCountdown says it; a weekday in the viewer's zone beyond a week.
 */
export function untilLabel(airingAt: Date, now: Date, timeZone?: string): string {
  const minutes = Math.ceil((airingAt.getTime() - now.getTime()) / MINUTE_MS);
  if (minutes <= 0) return "now";
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  if (days >= 7) {
    return new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone }).format(airingAt);
  }
  if (days > 0) return hours > 0 ? `${String(days)}d ${String(hours)}h` : `${String(days)}d`;
  if (hours > 0) return mins > 0 ? `${String(hours)}h ${String(mins)}m` : `${String(hours)}h`;
  return `${String(mins)}m`;
}

/** "ep 9 out", or "3 out · eps 7–9" when several are waiting. */
export function outLabel(episodesWatched: number, latestAired: number): string {
  const behind = latestAired - episodesWatched;
  if (behind <= 1) return `ep ${String(latestAired)} out`;
  return `${String(behind)} out · eps ${String(episodesWatched + 1)}–${String(latestAired)}`;
}

/**
 * A show's airing line for a row (the design system's AiringCountdown): its new episodes when
 * you're watching it and behind, else when the next one airs. Null when AniList has nothing.
 */
export function airingLine(
  airing: AiringView | null,
  entry: { status: ListStatus; episodesWatched: number },
  now: Date,
): { text: string; out: boolean } | null {
  if (!airing) return null;
  if (
    entry.status === "watching" &&
    airing.latestAired !== null &&
    airing.latestAired > entry.episodesWatched
  ) {
    return { text: outLabel(entry.episodesWatched, airing.latestAired), out: true };
  }
  if (airing.nextEpisode !== null && airing.nextAiringAt !== null) {
    const when = untilLabel(new Date(airing.nextAiringAt), now);
    return { text: `ep ${String(airing.nextEpisode)} in ${when}`, out: false };
  }
  return null;
}

/** A show's page in kurisu. */
export function showHref(animeId: number): string {
  return `/shows/${String(animeId)}`;
}
