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
