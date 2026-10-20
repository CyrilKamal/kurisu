import type { AniListSeason } from "../anilist/client.js";
import { seasonOf } from "../recommend/season.js";

const SEASONS: AniListSeason[] = ["WINTER", "SPRING", "SUMMER", "FALL"];
const NAMES: Record<AniListSeason, string> = {
  WINTER: "Winter",
  SPRING: "Spring",
  SUMMER: "Summer",
  FALL: "Fall",
};

export interface Season {
  season: AniListSeason;
  year: number;
}

/** The season `steps` seasons after this one (or before, when negative). */
export function shiftSeason(from: Season, steps: number): Season {
  const index = from.year * 4 + SEASONS.indexOf(from.season) + steps;
  return { season: SEASONS[((index % 4) + 4) % 4] ?? "WINTER", year: Math.floor(index / 4) };
}

/** The earliest season Browse goes back to. */
export const FIRST_SEASON: Season = { season: "WINTER", year: 1960 };

/** Seasons in order: negative when `a` comes first. */
export function compareSeasons(a: Season, b: Season): number {
  return a.year * 4 + SEASONS.indexOf(a.season) - (b.year * 4 + SEASONS.indexOf(b.season));
}

/** Whether Browse shows this season: from Winter 1960 to next season. */
export function browsable(season: Season, now: Date): boolean {
  const next = shiftSeason(seasonOf(now), 1);
  return compareSeasons(season, FIRST_SEASON) >= 0 && compareSeasons(season, next) <= 0;
}

/** The seasons Browse keeps fresh: last, this and next. */
export function chartedSeasons(now: Date): Season[] {
  const { season, year } = seasonOf(now);
  const current = { season, year };
  return [shiftSeason(current, -1), current, shiftSeason(current, 1)];
}

/** "2027-WINTER", as a season appears in a URL. */
export function seasonParam(season: Season): string {
  return `${String(season.year)}-${season.season}`;
}

/** A season from its URL form, or null. */
export function parseSeasonParam(value: string): Season | null {
  const match = /^(\d{4})-(WINTER|SPRING|SUMMER|FALL)$/.exec(value);
  if (!match) return null;
  return { season: match[2] as AniListSeason, year: Number(match[1]) };
}

/** "Winter 2027". */
export function seasonLabel(season: Season): string {
  return `${NAMES[season.season]} ${String(season.year)}`;
}
