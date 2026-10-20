import { createHash, randomBytes } from "node:crypto";

import { and, asc, eq, gte, lte, or, sql } from "drizzle-orm";

import type { StreamingLink } from "../anilist/client.js";
import { watchOn } from "../brief/services.js";
import type { TokenCipher } from "../crypto/tokenCipher.js";
import type { Db } from "../db/client.js";
import {
  airingEpisodes,
  anilistMedia,
  anime,
  briefSettings,
  calendarFeeds,
  listEntries,
  users,
} from "../db/schema.js";
import { icsCalendar, type CalendarEvent } from "./ics.js";

const DAY_MS = 24 * 60 * 60 * 1000;
/** Aired episodes stay in the feed this long, so the week's episodes don't vanish once out. */
const FEED_PAST_MS = 14 * DAY_MS;
const FEED_AHEAD_MS = 60 * DAY_MS;
const FEED_MAX_EVENTS = 500;
/** An episode's length when MAL doesn't know it. */
const DEFAULT_EPISODE_MINUTES = 24;
/** How often calendar apps should fetch again: the airing cache's own age. */
const FEED_REFRESH = "PT6H";
const FEED_NAME = "kurisu";

/** A token for a calendar link: 32 URL-safe characters. */
export const FEED_TOKEN = /^[A-Za-z0-9_-]{32}$/;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

const tokenContext = (userId: string) => `calendar_feed:${userId}`;

export interface Feed {
  token: string;
  lastFetchedAt: Date | null;
}

/** The user's calendar link, if they've turned it on. */
export async function readFeed(db: Db, cipher: TokenCipher, userId: string): Promise<Feed | null> {
  const [row] = await db
    .select({ tokenEnc: calendarFeeds.tokenEnc, lastFetchedAt: calendarFeeds.lastFetchedAt })
    .from(calendarFeeds)
    .where(eq(calendarFeeds.userId, userId));
  if (!row) return null;
  return {
    token: cipher.decrypt(row.tokenEnc, tokenContext(userId)),
    lastFetchedAt: row.lastFetchedAt,
  };
}

/** A new calendar link for the user; any old one stops working. */
export async function makeFeed(db: Db, cipher: TokenCipher, userId: string): Promise<Feed> {
  const token = randomBytes(24).toString("base64url");
  const row = {
    userId,
    tokenHash: hashToken(token),
    tokenEnc: cipher.encrypt(token, tokenContext(userId)),
    createdAt: new Date(),
    lastFetchedAt: null,
  };
  await db
    .insert(calendarFeeds)
    .values(row)
    .onConflictDoUpdate({ target: calendarFeeds.userId, set: row });
  return { token, lastFetchedAt: null };
}

export async function removeFeed(db: Db, userId: string): Promise<void> {
  await db.delete(calendarFeeds).where(eq(calendarFeeds.userId, userId));
}

/** Whose calendar link this is, noting that a calendar app fetched it. */
export async function fetchFeedOwner(db: Db, token: string, now: Date): Promise<string | null> {
  const [row] = await db
    .update(calendarFeeds)
    .set({ lastFetchedAt: now })
    .where(eq(calendarFeeds.tokenHash, hashToken(token)))
    .returning({ userId: calendarFeeds.userId });
  return row?.userId ?? null;
}

export interface FeedEpisode {
  malId: number;
  title: string;
  episode: number;
  airingAt: Date;
  episodeMinutes: number | null;
  /** MAL's episode count, to mark a finale. */
  numEpisodes: number | null;
  streamingLinks: StreamingLink[];
}

/**
 * The episodes the feed shows: every episode of a Watching show, and the premiere of a Plan to
 * Watch show, from two weeks back to two months ahead, from what AniList said (never projected).
 * Titles are in the user's language (Settings), MAL's romaji where a show has none.
 */
export async function feedEpisodes(db: Db, userId: string, now: Date): Promise<FeedEpisode[]> {
  const [owner] = await db
    .select({ language: users.titleLanguage })
    .from(users)
    .where(eq(users.id, userId));
  const title =
    owner?.language === "english"
      ? sql<string>`coalesce(nullif(trim(${anime.titleEn}), ''), ${anime.title})`
      : owner?.language === "japanese"
        ? sql<string>`coalesce(nullif(trim(${anime.titleJa}), ''), ${anime.title})`
        : anime.title;
  return db
    .select({
      malId: airingEpisodes.malId,
      title,
      episode: airingEpisodes.episode,
      airingAt: airingEpisodes.airingAt,
      episodeMinutes: anime.episodeMinutes,
      numEpisodes: anime.numEpisodes,
      streamingLinks: sql<StreamingLink[]>`coalesce(${anilistMedia.streamingLinks}, '[]'::jsonb)`,
    })
    .from(airingEpisodes)
    .innerJoin(
      listEntries,
      and(eq(listEntries.animeId, airingEpisodes.malId), eq(listEntries.userId, userId)),
    )
    .innerJoin(anime, eq(anime.malId, airingEpisodes.malId))
    .leftJoin(anilistMedia, eq(anilistMedia.malId, airingEpisodes.malId))
    .where(
      and(
        gte(airingEpisodes.airingAt, new Date(now.getTime() - FEED_PAST_MS)),
        lte(airingEpisodes.airingAt, new Date(now.getTime() + FEED_AHEAD_MS)),
        or(
          eq(listEntries.status, "watching"),
          and(eq(listEntries.status, "plan_to_watch"), eq(airingEpisodes.episode, 1)),
        ),
      ),
    )
    .orderBy(asc(airingEpisodes.airingAt), asc(title))
    .limit(FEED_MAX_EVENTS);
}

/** The streaming services the user said they have (their brief settings). */
export async function userServices(db: Db, userId: string): Promise<string[]> {
  const [row] = await db
    .select({ services: briefSettings.services })
    .from(briefSettings)
    .where(eq(briefSettings.userId, userId));
  return row?.services ?? [];
}

/** "Frieren · Episode 12", "· Premiere" for a first episode, "(finale)" for MAL's last. */
export function episodeSummary(episode: FeedEpisode): string {
  if (episode.episode === 1) return `${episode.title} · Premiere`;
  const finale = episode.numEpisodes !== null && episode.episode === episode.numEpisodes;
  return `${episode.title} · Episode ${String(episode.episode)}${finale ? " (finale)" : ""}`;
}

/**
 * The feed as iCalendar. Each event says where it streams on the user's own services (AniList's
 * links only; nothing when none match) and links to the show's page in kurisu. Without Pro the
 * calendar stays valid but empty, and says why.
 */
export function feedCalendar(input: {
  episodes: FeedEpisode[];
  services: string[];
  webOrigin: string;
  included: boolean;
  now: Date;
}): string {
  const events: CalendarEvent[] = input.included
    ? input.episodes.map((episode) => {
        const minutes = Math.min(
          180,
          Math.max(1, episode.episodeMinutes ?? DEFAULT_EPISODE_MINUTES),
        );
        const where = watchOn(episode.streamingLinks, input.services).map((w) => w.service);
        const url = `${input.webOrigin}/shows/${String(episode.malId)}`;
        return {
          uid: `${String(episode.malId)}-${String(episode.episode)}@kurisu`,
          start: episode.airingAt,
          end: new Date(episode.airingAt.getTime() + minutes * 60_000),
          summary: episodeSummary(episode),
          description: [where.length > 0 ? `On ${where.join(", ")}.` : null, `In kurisu: ${url}`]
            .filter((line) => line !== null)
            .join("\n"),
          url,
        };
      })
    : [];
  return icsCalendar({
    name: FEED_NAME,
    description: input.included
      ? "New episodes of the shows you're watching, and premieres on your Plan to Watch."
      : "kurisu's calendar comes with Pro. Your plan doesn't include it now, so it's empty.",
    refresh: FEED_REFRESH,
    events,
    now: input.now,
  });
}
