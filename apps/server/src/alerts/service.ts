import type { TitleLanguage } from "@kurisu/shared";
import { and, eq, gt, inArray, isNotNull, lte, notExists, sql } from "drizzle-orm";
import type { FastifyBaseLogger } from "fastify";

import { airingRows, refreshAiring } from "../anilist/cache.js";
import type { AniListClient } from "../anilist/client.js";
import type { Limits } from "../billing/limits.js";
import { watchOn } from "../brief/services.js";
import { numberEpisodes } from "../browse/load.js";
import type { Db } from "../db/client.js";
import {
  airingEpisodes,
  anilistMedia,
  anime,
  briefSettings,
  episodeAlertMutes,
  episodeAlerts,
  listEntries,
  pushSubscriptions,
  scheduleSlots,
  users,
} from "../db/schema.js";
import type { PushSender } from "../push/send.js";
import { titleIn } from "../titles/localize.js";
import { alertWindow, confirmedAired, episodesLabel, outNowLine } from "./rules.js";

export interface AlertDeps {
  db: Db;
  anilist: AniListClient;
  push: PushSender;
  limits: Limits;
  log: FastifyBaseLogger;
}

/** Someone who has episode alerts on and a device to send them to. */
interface Subscriber {
  userId: string;
  since: Date;
  services: string[];
  language: TitleLanguage;
}

/** An episode that aired for one of a user's Watching shows, in MAL's numbering. */
interface AiredEpisode {
  malId: number;
  title: string;
  episode: number;
  airingAt: Date;
}

export interface AlertRunOutcome {
  /** Pushes sent, one per user and show. */
  sent: number;
  /** Episodes due but not confirmed by AniList yet (delayed, or AniList unreachable). */
  unconfirmed: number;
}

async function subscribers(db: Db): Promise<Subscriber[]> {
  const rows = await db
    .select({
      userId: briefSettings.userId,
      since: briefSettings.episodeAlertsSince,
      services: briefSettings.services,
      language: users.titleLanguage,
    })
    .from(briefSettings)
    .innerJoin(users, eq(users.id, briefSettings.userId))
    .where(
      and(
        isNotNull(briefSettings.episodeAlertsSince),
        inArray(
          briefSettings.userId,
          db.selectDistinct({ userId: pushSubscriptions.userId }).from(pushSubscriptions),
        ),
      ),
    );
  return rows.flatMap((row) => (row.since ? [{ ...row, since: row.since }] : []));
}

/**
 * The episodes of a user's Watching shows that aired in the window and that they haven't watched
 * or been told about, numbered the way Browse's Schedule numbers them (AniList's shared schedule
 * with the part's offset, then the times kurisu recorded). Muted shows are left out.
 */
async function airedFor(db: Db, user: Subscriber, now: Date): Promise<AiredEpisode[]> {
  const { from, to } = alertWindow(now, user.since);
  const watching = and(
    eq(listEntries.userId, user.userId),
    eq(listEntries.status, "watching"),
    notExists(
      db
        .select({ one: sql`1` })
        .from(episodeAlertMutes)
        .where(
          and(
            eq(episodeAlertMutes.userId, user.userId),
            eq(episodeAlertMutes.malId, listEntries.animeId),
          ),
        ),
    ),
  );
  const show = {
    title: titleIn(user.language),
    watched: listEntries.numEpisodesWatched,
  };
  const slots = await db
    .select({
      anilistId: scheduleSlots.anilistId,
      malId: scheduleSlots.malId,
      episode: scheduleSlots.episode,
      airingAt: scheduleSlots.airingAt,
      ...show,
    })
    .from(scheduleSlots)
    .innerJoin(listEntries, and(eq(listEntries.animeId, scheduleSlots.malId), watching))
    .innerJoin(anime, eq(anime.malId, scheduleSlots.malId))
    .where(and(gt(scheduleSlots.airingAt, from), lte(scheduleSlots.airingAt, to)));
  const recorded = await db
    .select({
      malId: airingEpisodes.malId,
      episode: airingEpisodes.episode,
      airingAt: airingEpisodes.airingAt,
      ...show,
    })
    .from(airingEpisodes)
    .innerJoin(listEntries, and(eq(listEntries.animeId, airingEpisodes.malId), watching))
    .innerJoin(anime, eq(anime.malId, airingEpisodes.malId))
    .where(and(gt(airingEpisodes.airingAt, from), lte(airingEpisodes.airingAt, to)));

  const ids = [...new Set([...slots, ...recorded].map((row) => row.malId))];
  if (ids.length === 0) return [];
  const parts = new Map(
    (
      await db
        .select({
          malId: anilistMedia.malId,
          anilistId: anilistMedia.anilistId,
          episodeOffset: anilistMedia.episodeOffset,
        })
        .from(anilistMedia)
        .where(inArray(anilistMedia.malId, ids))
    ).map((row) => [row.malId, row]),
  );
  const sent = new Set(
    (
      await db
        .select({ malId: episodeAlerts.malId, episode: episodeAlerts.episode })
        .from(episodeAlerts)
        .where(and(eq(episodeAlerts.userId, user.userId), inArray(episodeAlerts.malId, ids)))
    ).map((row) => `${String(row.malId)}:${String(row.episode)}`),
  );

  return numberEpisodes(slots, recorded, (malId) => parts.get(malId)).flatMap(
    ({ row, episode, airingAt }) =>
      episode > row.watched && !sent.has(`${String(row.malId)}:${String(episode)}`)
        ? [{ malId: row.malId, title: row.title, episode, airingAt }]
        : [],
  );
}

/**
 * One run of episode alerts (every 5 minutes, beside the brief): for each user with alerts on,
 * their plan's `episodeAlerts` and a push subscription, a push per Watching show with an episode
 * out. AniList is asked again about each due show first, and an alert goes out only once it
 * confirms the episode aired (never guessed from the schedule alone). Each episode is recorded
 * before its push, so it's sent at most once.
 */
export async function runEpisodeAlerts(
  deps: AlertDeps,
  now: Date = new Date(),
): Promise<AlertRunOutcome> {
  const { db, log } = deps;
  const outcome: AlertRunOutcome = { sent: 0, unconfirmed: 0 };
  const everyone = await subscribers(db);
  const allowed: Subscriber[] = [];
  for (const user of everyone) {
    if (await deps.limits.has(user.userId, "episodeAlerts")) allowed.push(user);
  }

  // A first look finds the shows due, so AniList is asked about them in one request.
  const firstLook = (await Promise.all(allowed.map((user) => airedFor(db, user, now)))).flat();
  if (firstLook.length === 0) return outcome;
  const dueAt = new Map<number, number>();
  for (const aired of firstLook) {
    dueAt.set(aired.malId, Math.max(dueAt.get(aired.malId) ?? 0, aired.airingAt.getTime()));
  }
  const before = await airingRows(db, [...dueAt.keys()]);
  const stale = [...dueAt].flatMap(([malId, at]) => {
    const row = before.get(malId);
    return !row || row.fetchedAt.getTime() < at ? [malId] : [];
  });
  try {
    await refreshAiring({ db, anilist: deps.anilist, log }, stale, { now, maxAgeMs: 0 });
  } catch (err) {
    log.warn({ err: { name: (err as Error).name } }, "could not check episodes with AniList");
    outcome.unconfirmed = firstLook.length;
    return outcome;
  }
  const media = await airingRows(db, [...dueAt.keys()]);

  for (const user of allowed) {
    // Looked at again, since a refetched part can number its episodes differently.
    const aired = await airedFor(db, user, now);
    const byShow = new Map<number, AiredEpisode[]>();
    for (const episode of aired) {
      if (!confirmedAired(media.get(episode.malId) ?? null, episode.episode, episode.airingAt)) {
        outcome.unconfirmed++;
        continue;
      }
      byShow.set(episode.malId, [...(byShow.get(episode.malId) ?? []), episode]);
    }

    for (const [malId, episodes] of byShow) {
      const claimed = await db
        .insert(episodeAlerts)
        .values(episodes.map((e) => ({ userId: user.userId, malId, episode: e.episode })))
        .onConflictDoNothing()
        .returning({ episode: episodeAlerts.episode });
      if (claimed.length === 0) continue;
      const title = episodes[0]?.title ?? "";
      const result = await deps.push.sendToUser(user.userId, {
        title: `${title} · ${episodesLabel(claimed.map((c) => c.episode))}`,
        body: outNowLine(watchOn(media.get(malId)?.streamingLinks ?? [], user.services)),
        url: `/shows/${String(malId)}`,
        tag: `episode:${String(malId)}`,
      });
      if (result.sent > 0) outcome.sent++;
      log.info(
        { userId: user.userId, malId, episodes: claimed.length, push: result },
        "episode alert",
      );
    }
  }
  return outcome;
}

/** Whether a user has episode alerts on, and the shows they muted. */
export async function alertSettings(
  db: Db,
  userId: string,
): Promise<{ on: boolean; muted: number[] }> {
  const [settings] = await db
    .select({ since: briefSettings.episodeAlertsSince })
    .from(briefSettings)
    .where(eq(briefSettings.userId, userId));
  const muted = await db
    .select({ malId: episodeAlertMutes.malId })
    .from(episodeAlertMutes)
    .where(eq(episodeAlertMutes.userId, userId));
  return { on: Boolean(settings?.since), muted: muted.map((row) => row.malId) };
}

/** Turns alerts on (from now: nothing that aired before is sent) or off. */
export async function setAlerts(db: Db, userId: string, on: boolean, now = new Date()) {
  const since = on ? now : null;
  await db
    .insert(briefSettings)
    .values({ userId, episodeAlertsSince: since })
    .onConflictDoUpdate({
      target: briefSettings.userId,
      // Turning them on while they're on keeps the time they were first turned on.
      set: {
        episodeAlertsSince: on
          ? sql`coalesce(${briefSettings.episodeAlertsSince}, ${now.toISOString()}::timestamptz)`
          : null,
        updatedAt: now,
      },
    });
}

/** Mutes or unmutes one show's alerts. */
export async function setShowMuted(db: Db, userId: string, malId: number, muted: boolean) {
  if (muted) {
    await db.insert(episodeAlertMutes).values({ userId, malId }).onConflictDoNothing();
  } else {
    await db
      .delete(episodeAlertMutes)
      .where(and(eq(episodeAlertMutes.userId, userId), eq(episodeAlertMutes.malId, malId)));
  }
}
