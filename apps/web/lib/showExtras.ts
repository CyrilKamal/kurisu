import type { ShowExtrasView } from "@kurisu/shared";

const SOURCES: Record<string, string> = {
  ORIGINAL: "Original",
  MANGA: "Manga",
  LIGHT_NOVEL: "Light novel",
  VISUAL_NOVEL: "Visual novel",
  VIDEO_GAME: "Video game",
  NOVEL: "Novel",
  WEB_NOVEL: "Web novel",
  DOUJINSHI: "Doujinshi",
  ANIME: "Anime",
  LIVE_ACTION: "Live action",
  GAME: "Game",
  COMIC: "Comic",
  MULTIMEDIA_PROJECT: "Multimedia project",
  PICTURE_BOOK: "Picture book",
};

/** "Based on a light novel", or null when AniList says nothing useful. */
export function sourceLine(source: string | null): string | null {
  if (!source || source === "OTHER") return null;
  if (source === "ORIGINAL") return "Original story";
  const words = SOURCES[source];
  return words ? `From the ${words.toLowerCase()}` : null;
}

const RELATIONS: Record<string, string> = {
  PREQUEL: "Prequel",
  SEQUEL: "Sequel",
  PARENT: "Main story",
  SIDE_STORY: "Side story",
  SPIN_OFF: "Spin-off",
  ALTERNATIVE: "Alternative version",
  SUMMARY: "Summary",
  COMPILATION: "Compilation",
  CONTAINS: "Contains",
  CHARACTER: "Same characters",
  OTHER: "Related",
};

/** "Side story" for AniList's SIDE_STORY. */
export function relationLabel(relation: string): string {
  return RELATIONS[relation] ?? "Related";
}

/** "#4 most popular, Fall 2026". */
export function rankingLabel(ranking: ShowExtrasView["rankings"][number]): string {
  const kind = ranking.kind === "popular" ? "most popular" : "highest rated";
  return `#${String(ranking.rank)} ${kind}, ${ranking.scope}`;
}

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

/**
 * MAL's broadcast slot in words: "Saturdays 23:00 JST", and when that is in `timeZone` (this
 * device's when left out) if it's another clock: "Saturdays 23:00 JST · Sat 4:00 PM yours", for
 * the coming week (so summer time is right). A late-night "25:30" is 1:30 the next day. Null for
 * a weekday MAL didn't name.
 */
export function broadcastLabel(
  day: string,
  time: string | null,
  timeZone?: string,
  now: Date = new Date(),
): string | null {
  const index = WEEKDAYS.indexOf(day);
  if (index === -1) return null;
  const days = `${day.charAt(0).toUpperCase()}${day.slice(1)}s`;
  const match = time ? /^(\d{1,2}):(\d{2})$/.exec(time) : null;
  if (!match) return `${days} in Japan`;
  const japan = `${days} ${time ?? ""} JST`;
  // Japan is UTC+9 all year: shifted by 9 hours, the UTC fields read as Japan's.
  const tokyo = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const ahead = (index - tokyo.getUTCDay() + 7) % 7;
  const at = new Date(
    Date.UTC(
      tokyo.getUTCFullYear(),
      tokyo.getUTCMonth(),
      tokyo.getUTCDate() + ahead,
      Number(match[1]) - 9,
      Number(match[2]),
    ),
  );
  const local = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  }).format(at);
  const inJapan = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Asia/Tokyo",
  }).format(at);
  return local === inJapan ? japan : `${japan} · ${local} yours`;
}
