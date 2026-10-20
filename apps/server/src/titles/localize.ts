import type { TitleLanguage } from "@kurisu/shared";
import { inArray, sql, type SQL } from "drizzle-orm";
import type { FastifyInstance } from "fastify";

import type { Db } from "../db/client.js";
import { anime } from "../db/schema.js";

declare module "fastify" {
  interface FastifyContextConfig {
    /** The reply keeps titles as stored, whatever the user's title language (the data export). */
    titlesAsStored?: boolean;
  }
}

type Titled = Record<string, unknown> & { animeId: number; title: string };

/** How deep a reply is walked for shows; replies are never nested deeper. */
const MAX_DEPTH = 12;

/** Every object in a reply that names a show: a numeric `animeId` beside a string `title`. */
export function showsIn(value: unknown, found: Titled[] = [], depth = 0): Titled[] {
  if (depth > MAX_DEPTH || value === null || typeof value !== "object" || value instanceof Date) {
    return found;
  }
  if (Array.isArray(value)) {
    for (const item of value) showsIn(item, found, depth + 1);
    return found;
  }
  const obj = value as Record<string, unknown>;
  if (typeof obj.animeId === "number" && typeof obj.title === "string") found.push(obj as Titled);
  for (const child of Object.values(obj)) showsIn(child, found, depth + 1);
  return found;
}

/**
 * Gives each show its title in the user's language, where the show has one; the romaji title
 * then leads its `altTitles`, if it has them. Changes the objects in place.
 */
export function swapTitles(
  shows: Titled[],
  titles: ReadonlyMap<number, { english: string | null; japanese: string | null }>,
  language: Exclude<TitleLanguage, "romaji">,
): void {
  for (const show of shows) {
    const local = titles.get(show.animeId)?.[language]?.trim();
    if (!local || local === show.title) continue;
    const romaji = show.title;
    show.title = local;
    if (Array.isArray(show.altTitles)) {
      const others = (show.altTitles as unknown[]).filter(
        (t): t is string => typeof t === "string" && t !== local && t !== romaji,
      );
      show.altTitles = [romaji, ...others];
    }
  }
}

/**
 * A show's title in this language, as a column for a query, for text the server writes itself
 * (the calendar feed, episode alerts): MAL's romaji where the show has none.
 */
export function titleIn(language: TitleLanguage | undefined): SQL<string> | typeof anime.title {
  if (language === "english") {
    return sql<string>`coalesce(nullif(trim(${anime.titleEn}), ''), ${anime.title})`;
  }
  if (language === "japanese") {
    return sql<string>`coalesce(nullif(trim(${anime.titleJa}), ''), ${anime.title})`;
  }
  return anime.title;
}

/**
 * Shows' titles in the user's chosen language (Settings), in every reply to a signed-in user:
 * one place instead of every query. Titles the model or the brief wrote into text stay MAL's,
 * since the agent reads them back; so do the data export's.
 */
export function registerTitleLanguage(app: FastifyInstance, db: Db): void {
  app.addHook("preSerialization", async (request, reply, payload) => {
    const language = request.user?.titleLanguage;
    if (!language || language === "romaji" || reply.statusCode >= 300) return payload;
    if (request.routeOptions.config.titlesAsStored) return payload;
    const shows = showsIn(payload);
    if (shows.length === 0) return payload;
    const ids = [...new Set(shows.map((show) => show.animeId))];
    const rows = await db
      .select({ malId: anime.malId, english: anime.titleEn, japanese: anime.titleJa })
      .from(anime)
      .where(inArray(anime.malId, ids));
    swapTitles(shows, new Map(rows.map(({ malId, ...titles }) => [malId, titles])), language);
    return payload;
  });
}
