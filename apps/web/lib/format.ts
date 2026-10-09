import type {
  LastSync,
  ListEntry,
  ListStatus,
  LoginError,
  ShowCard,
  SyncError,
} from "@kurisu/shared";

export const STATUS_LABELS: Record<ListStatus, string> = {
  watching: "Watching",
  completed: "Completed",
  on_hold: "On hold",
  dropped: "Dropped",
  plan_to_watch: "Plan to watch",
};

const MEDIA_TYPE_LABELS: Record<string, string> = {
  tv: "TV",
  tv_special: "TV special",
  movie: "Movie",
  ova: "OVA",
  ona: "ONA",
  special: "Special",
  music: "Music",
  cm: "CM",
  pv: "PV",
};

export function mediaTypeLabel(mediaType: string | null): string | null {
  if (!mediaType || mediaType === "unknown") return null;
  return MEDIA_TYPE_LABELS[mediaType] ?? mediaType;
}

/** "Watching · ep 5 of 12 · TV · 12 eps × 24 min", or "Not on your list · Movie · 110 min". */
export function showDetails(show: ShowCard): string {
  const where =
    show.status === null
      ? "Not on your list"
      : show.status === "plan_to_watch"
        ? STATUS_LABELS.plan_to_watch
        : `${STATUS_LABELS[show.status]} · ep ${String(show.episodesWatched)}${
            show.numEpisodes === null ? "" : ` of ${String(show.numEpisodes)}`
          }`;
  const length =
    show.episodeMinutes === null
      ? null
      : show.numEpisodes === 1
        ? `${String(show.episodeMinutes)} min`
        : show.numEpisodes === null
          ? `${String(show.episodeMinutes)} min eps`
          : `${String(show.numEpisodes)} eps × ${String(show.episodeMinutes)} min`;
  return [where, mediaTypeLabel(show.mediaType), length].filter((p) => p !== null).join(" · ");
}

/** "46m", "4h", "4h 48m". */
export function durationLabel(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${String(m)}m`;
  return m === 0 ? `${String(h)}h` : `${String(h)}h ${String(m)}m`;
}

/** "7 / 12 eps", "1 / 1 ep", or "3 / ? eps" when MAL doesn't know the episode count yet. */
export function progressLabel(entry: Pick<ListEntry, "episodesWatched" | "numEpisodes">): string {
  const total = entry.numEpisodes;
  const unit = total === 1 ? "ep" : "eps";
  return `${String(entry.episodesWatched)} / ${total === null ? "?" : String(total)} ${unit}`;
}

export function countByStatus(entries: Pick<ListEntry, "status">[]): Record<ListStatus, number> {
  const counts: Record<ListStatus, number> = {
    watching: 0,
    completed: 0,
    on_hold: 0,
    dropped: 0,
    plan_to_watch: 0,
  };
  for (const entry of entries) counts[entry.status] += 1;
  return counts;
}

const relative = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

/** "just now", "5 minutes ago", "yesterday", ... */
export function relativeTime(iso: string, now: Date = new Date()): string {
  const seconds = Math.round((new Date(iso).getTime() - now.getTime()) / 1000);
  const abs = Math.abs(seconds);
  if (abs < 45) return "just now";
  if (abs < 45 * 60) return relative.format(Math.round(seconds / 60), "minute");
  if (abs < 22 * 3600) return relative.format(Math.round(seconds / 3600), "hour");
  if (abs < 26 * 86400) return relative.format(Math.round(seconds / 86400), "day");
  return relative.format(Math.round(seconds / (30 * 86400)), "month");
}

/** One line for the List header describing the last sync. */
export function lastSyncLabel(lastSync: LastSync | null, now: Date = new Date()): string {
  if (!lastSync) return "Not synced yet";
  const when = relativeTime(lastSync.finishedAt ?? lastSync.startedAt, now);
  switch (lastSync.status) {
    case "running":
      return "Syncing…";
    case "succeeded":
      return `Synced ${when}`;
    case "failed":
      return `Last sync failed ${when}`;
  }
}

export function syncErrorMessage(error: SyncError | null): string {
  switch (error) {
    case "reauth_required":
      return "MyAnimeList needs you to log in again.";
    case "mal_unavailable":
      return "Couldn't reach MyAnimeList.";
    case "invalid_response":
      return "MyAnimeList sent something unexpected.";
    case "interrupted":
      return "The sync was interrupted.";
    case "internal_error":
    case null:
      return "Something went wrong on our side.";
  }
}

export function loginErrorMessage(code: string | undefined): string | null {
  if (code === undefined) return null;
  const messages: Record<LoginError, string> = {
    access_denied: "You declined access on MyAnimeList. Log in again to connect your list.",
    invalid_request: "That login link didn't work. Please try again.",
    invalid_state: "That login expired or was already used. Please try again.",
    token_exchange_failed: "MyAnimeList didn't accept the login. Please try again.",
    mal_unavailable: "Couldn't reach MyAnimeList. Please try again in a minute.",
    invite_only: "kurisu is invite-only for now, so that MyAnimeList account can't sign up.",
  };
  return code in messages ? messages[code as LoginError] : messages.invalid_request;
}
