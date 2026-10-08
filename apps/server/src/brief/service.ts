import { and, desc, eq, inArray, ne, sql, type SQL } from "drizzle-orm";
import type { FastifyBaseLogger } from "fastify";

import { airingRows, refreshAiring } from "../anilist/cache.js";
import { rememberShows } from "../anilist/catalog.js";
import type { AniListClient } from "../anilist/client.js";
import { completedIds, refreshSequels, sequelCandidates } from "../anilist/sequels.js";
import { createConversation } from "../chat/service.js";
import { MAX_SHOW_CARDS } from "../chat/mentions.js";
import type { Db } from "../db/client.js";
import {
  anime,
  briefs,
  briefSettings,
  chatMessages,
  listEntries,
  pushSubscriptions,
} from "../db/schema.js";
import type { ModelClient } from "../llm/modelClient.js";
import type { ModelRef } from "../llm/modelConfig.js";
import type { PushResult, PushSender } from "../push/send.js";
import {
  alertSummary,
  briefTitle,
  buildBriefAlerts,
  buildBriefItems,
  chatText,
  episodeCount,
  pushText,
  type BriefAlert,
  type BriefItem,
} from "./build.js";
import { BRIEF_SUMMARY_PROMPT, writeSummary, type SummaryResult } from "./summary.js";
import { briefTiming, localClock } from "./timing.js";

const HOUR_MS = 60 * 60 * 1000;
/** The first brief, and every test brief, covers the last day. */
const DEFAULT_WINDOW_MS = 24 * HOUR_MS;
/** However long since the last brief, a brief never reaches back further than this. */
const MAX_WINDOW_MS = 48 * HOUR_MS;

export interface BriefDeps {
  db: Db;
  anilist: AniListClient;
  push: PushSender;
  models: ModelClient;
  model: ModelRef;
  log: FastifyBaseLogger;
}

export type BriefRequest = { kind: "daily"; localDate: string } | { kind: "test" };

export interface BriefOutcome {
  /** "skipped" means this day's brief was already handled. */
  status: "sent" | "empty" | "skipped";
  briefId: string | null;
  episodes: number;
  /** Shows that started airing. */
  alerts: number;
  push: PushResult;
}

/** AniList couldn't be reached (after the client's own retries). */
export class AniListUnavailableError extends Error {
  constructor(options?: { cause?: unknown }) {
    super("AniList is unavailable", options);
    this.name = "AniListUnavailableError";
  }
}

/** Thrown when every push failed, so the queue retries the brief. */
export class BriefPushError extends Error {
  constructor() {
    super("no push service accepted the brief");
    this.name = "BriefPushError";
  }
}

const NO_PUSH: PushResult = { sent: 0, removed: 0, failed: 0 };

/**
 * Builds and sends one brief: new episodes of the user's Watching shows since the last brief,
 * and shows that started airing (a sequel to one they finished, or one on their Plan to Watch),
 * as a chat message and a push notification. A daily brief happens at most once per local date;
 * a retry picks up where the last attempt stopped and never posts the chat message twice.
 * Throws when AniList is unreachable or every push fails, so the queue retries.
 */
export async function runBrief(
  deps: BriefDeps,
  userId: string,
  request: BriefRequest,
  now: Date = new Date(),
): Promise<BriefOutcome> {
  const { db } = deps;
  const brief = await claim(db, userId, request);
  if (!brief) return { status: "skipped", briefId: null, episodes: 0, alerts: 0, push: NO_PUSH };

  if (brief.status === "ready" && brief.items) {
    // A previous attempt saved the chat message but didn't get the push out.
    return deliver(deps, userId, brief.id, brief.items, brief.alerts, request.kind);
  }

  try {
    const windowStart =
      request.kind === "daily"
        ? await dailyWindowStart(db, userId, brief.id, now)
        : new Date(now.getTime() - DEFAULT_WINDOW_MS);
    const { items, alerts } = await gather(deps, userId, windowStart, now);
    const window = { windowStart, windowEnd: now, items, alerts };

    if (items.length === 0 && alerts.length === 0) {
      await update(db, brief.id, { ...window, status: "empty", error: null });
      return { status: "empty", briefId: brief.id, episodes: 0, alerts: 0, push: NO_PUSH };
    }

    // The model writes the line about new episodes; a brief of only premieres needs no model.
    const summary =
      items.length > 0
        ? await writeSummary(deps.models, deps.model, items)
        : alertsOnlySummary(deps.model.ref, alerts);
    if (summary.rejected) {
      deps.log.warn(
        { briefId: brief.id, reason: summary.rejected },
        "brief summary fell back to the template",
      );
    }
    const localDate =
      request.kind === "daily"
        ? request.localDate
        : localClock(now, await userTimeZone(db, userId)).date;
    await db.transaction(async (tx) => {
      // Each brief starts its own chat, so a reply to it never lands in an unrelated thread.
      const conversationId = await createConversation(tx, userId, briefTitle(localDate));
      const [message] = await tx
        .insert(chatMessages)
        .values({
          conversationId,
          role: "assistant",
          content: chatText(summary.text, items, alerts),
          // A card for each show that started airing, to add it from or see where it is.
          showIds: alerts.map((a) => a.malId).slice(0, MAX_SHOW_CARDS),
        })
        .returning({ id: chatMessages.id });
      await tx
        .update(briefs)
        .set({
          ...window,
          status: "ready",
          summary: summary.text,
          summarySource: summary.source,
          model: summary.model,
          promptVersion: summary.promptVersion,
          inputTokens: summary.inputTokens,
          outputTokens: summary.outputTokens,
          summaryLatencyMs: summary.latencyMs,
          chatMessageId: message?.id ?? null,
          error: null,
          updatedAt: new Date(),
        })
        .where(eq(briefs.id, brief.id));
    });
  } catch (err) {
    await update(db, brief.id, { status: "failed", error: errorCode(err) });
    throw err;
  }
  const saved = await loadSaved(db, brief.id);
  return deliver(deps, userId, brief.id, saved.items, saved.alerts, request.kind);
}

/** The summary of a brief with only shows that started airing: a template, no model call. */
function alertsOnlySummary(model: string, alerts: BriefAlert[]): SummaryResult {
  return {
    text: alertSummary(alerts),
    source: "template",
    model,
    promptVersion: BRIEF_SUMMARY_PROMPT.version,
    inputTokens: null,
    outputTokens: null,
    latencyMs: null,
    rejected: null,
  };
}

/**
 * Pushes a brief whose chat message is saved, and records the result. A daily brief that no
 * push service accepted throws, so the queue retries the push.
 */
async function deliver(
  deps: BriefDeps,
  userId: string,
  briefId: string,
  items: BriefItem[],
  alerts: BriefAlert[],
  kind: BriefRequest["kind"],
): Promise<BriefOutcome> {
  const push = await deps.push.sendToUser(userId, {
    ...pushText(items, alerts),
    url: await briefPath(deps.db, briefId),
    tag: "brief",
  });
  const allFailed = push.sent === 0 && push.failed > 0;
  await update(deps.db, briefId, {
    status: allFailed ? "ready" : "sent",
    pushSent: push.sent,
    pushFailed: push.failed,
    error: allFailed ? "push_failed" : null,
  });
  if (allFailed && kind === "daily") throw new BriefPushError();
  return {
    status: "sent",
    briefId,
    episodes: episodeCount(items),
    alerts: alerts.length,
    push,
  };
}

type BriefRow = typeof briefs.$inferSelect;

/**
 * The brief row this attempt works on. For a daily brief, null when that day's brief is already
 * done; an unfinished one (building, ready or failed) is picked up again.
 */
async function claim(db: Db, userId: string, request: BriefRequest): Promise<BriefRow | null> {
  if (request.kind === "test") {
    const [row] = await db
      .insert(briefs)
      .values({ userId, kind: "test", status: "building" })
      .returning();
    return row ?? null;
  }
  const [inserted] = await db
    .insert(briefs)
    .values({ userId, kind: "daily", localDate: request.localDate, status: "building" })
    .onConflictDoNothing({
      target: [briefs.userId, briefs.localDate],
      where: sql`${briefs.kind} = 'daily'`,
    })
    .returning();
  if (inserted) return inserted;

  const [existing] = await db
    .select()
    .from(briefs)
    .where(
      and(
        eq(briefs.userId, userId),
        eq(briefs.kind, "daily"),
        eq(briefs.localDate, request.localDate),
      ),
    );
  if (!existing || ["sent", "empty", "skipped_late"].includes(existing.status)) return null;
  return existing;
}

/** Where a daily brief's window starts: the end of the last daily brief that went out. */
async function dailyWindowStart(db: Db, userId: string, briefId: string, now: Date): Promise<Date> {
  const [previous] = await db
    .select({ windowEnd: briefs.windowEnd })
    .from(briefs)
    .where(
      and(
        eq(briefs.userId, userId),
        eq(briefs.kind, "daily"),
        inArray(briefs.status, ["sent", "empty", "ready"]),
        ne(briefs.id, briefId),
      ),
    )
    .orderBy(desc(briefs.windowEnd))
    .limit(1);
  const floor = now.getTime() - MAX_WINDOW_MS;
  const start = previous?.windowEnd?.getTime() ?? now.getTime() - DEFAULT_WINDOW_MS;
  return new Date(Math.max(start, floor));
}

/**
 * What a brief covers: the user's Watching shows with episodes that aired in the window, and
 * shows whose first episode aired in it (Plan to Watch shows that are airing or about to, and
 * sequels to shows they completed). One AniList request covers both. Sequel relations are
 * refreshed weekly on the side; if that fails, the cached ones are used.
 */
async function gather(
  deps: BriefDeps,
  userId: string,
  windowStart: Date,
  windowEnd: Date,
): Promise<{ items: BriefItem[]; alerts: BriefAlert[] }> {
  const { db } = deps;
  // The user's shows with this status (and filter): what the brief needs to know of each.
  const listShows = (status: "watching" | "plan_to_watch", ...filters: SQL[]) =>
    db
      .select({
        malId: anime.malId,
        title: anime.title,
        episodesWatched: listEntries.numEpisodesWatched,
        numEpisodes: anime.numEpisodes,
      })
      .from(listEntries)
      .innerJoin(anime, eq(anime.malId, listEntries.animeId))
      .where(and(eq(listEntries.userId, userId), eq(listEntries.status, status), ...filters));
  const watching = await listShows("watching");
  // Plan to Watch shows MAL says are airing or about to: the ones that can premiere.
  const ptw = await listShows(
    "plan_to_watch",
    inArray(anime.airingStatus, ["currently_airing", "not_yet_aired"]),
  );
  try {
    await refreshSequels(deps, await completedIds(db, userId), { now: windowEnd });
  } catch (err) {
    deps.log.warn(
      { err: { name: (err as Error).name } },
      "could not refresh sequels; using the cached ones",
    );
  }
  const sequels = await sequelCandidates(db, userId);
  if (watching.length === 0 && ptw.length === 0 && sequels.length === 0) {
    return { items: [], alerts: [] };
  }

  const listIds = [...watching, ...ptw].map((show) => show.malId);
  const malIdByAniList = new Map<number, number>();
  let rows: Awaited<ReturnType<typeof airingRows>>;
  let aired: Awaited<ReturnType<AniListClient["airedBetween"]>>;
  try {
    await refreshAiring(deps, listIds, { now: windowEnd });
    rows = await airingRows(db, listIds);
    for (const row of rows.values()) {
      if (row.anilistId !== null) malIdByAniList.set(row.anilistId, row.malId);
    }
    // A sequel isn't on the list, so it has no cached row: its AniList id came with the relation.
    for (const { sequel } of sequels) {
      if (!malIdByAniList.has(sequel.anilistId)) malIdByAniList.set(sequel.anilistId, sequel.malId);
    }
    aired = await deps.anilist.airedBetween([...malIdByAniList.keys()], windowStart, windowEnd);
  } catch (err) {
    throw new AniListUnavailableError({ cause: err });
  }

  const [settings] = await db
    .select({ services: briefSettings.services })
    .from(briefSettings)
    .where(eq(briefSettings.userId, userId));
  const services = settings?.services ?? [];
  const episodes = aired.flatMap((a) => {
    const malId = malIdByAniList.get(a.anilistId);
    if (malId === undefined) return [];
    // AniList numbers each part of a split show from 1; MAL counts straight through.
    const offset = rows.get(malId)?.episodeOffset ?? 0;
    return [{ malId, episode: a.episode + offset, airedAt: a.airedAt }];
  });
  const links = new Map([
    ...sequels.map(({ sequel }) => [sequel.malId, sequel.streamingLinks] as const),
    ...[...rows.values()].map((row) => [row.malId, row.streamingLinks] as const),
  ]);

  const items = buildBriefItems({ watching, aired: episodes, links, services });
  const alerts = buildBriefAlerts({
    ptw,
    sequels: sequels.map(({ sequel, after }) => ({
      malId: sequel.malId,
      title: sequel.title,
      after,
    })),
    aired: episodes,
    links,
    services,
  });
  // A sequel that started needs a show row for its card (and to be added from it).
  const started = new Set(alerts.map((a) => a.malId));
  await rememberShows(
    db,
    sequels.filter(({ sequel }) => started.has(sequel.malId)).map(({ sequel }) => sequel),
  );
  return { items, alerts };
}

/**
 * Daily briefs that are due now: users with the brief on and at least one push subscription,
 * whose brief time has passed today and who have no brief for today yet. A day whose brief time
 * passed too long ago (the server was down) is marked skipped instead.
 */
export async function dueBriefs(
  db: Db,
  now: Date = new Date(),
): Promise<{ userId: string; localDate: string }[]> {
  const candidates = await db
    .select({
      userId: briefSettings.userId,
      localTime: briefSettings.localTime,
      timeZone: briefSettings.timeZone,
    })
    .from(briefSettings)
    .where(
      and(
        eq(briefSettings.enabled, true),
        sql`exists (select 1 from ${pushSubscriptions} where ${pushSubscriptions.userId} = ${briefSettings.userId})`,
      ),
    );

  const due: { userId: string; localDate: string }[] = [];
  for (const candidate of candidates) {
    const timing = briefTiming(candidate, now);
    if (!timing.due) continue;
    const [existing] = await db
      .select({ id: briefs.id })
      .from(briefs)
      .where(
        and(
          eq(briefs.userId, candidate.userId),
          eq(briefs.kind, "daily"),
          eq(briefs.localDate, timing.localDate),
        ),
      );
    if (existing) continue;
    if (timing.late) {
      await db
        .insert(briefs)
        .values({
          userId: candidate.userId,
          kind: "daily",
          localDate: timing.localDate,
          status: "skipped_late",
        })
        .onConflictDoNothing({
          target: [briefs.userId, briefs.localDate],
          where: sql`${briefs.kind} = 'daily'`,
        });
      continue;
    }
    due.push({ userId: candidate.userId, localDate: timing.localDate });
  }
  return due;
}

async function update(
  db: Db,
  briefId: string,
  values: Partial<typeof briefs.$inferInsert>,
): Promise<void> {
  await db
    .update(briefs)
    .set({ ...values, updatedAt: new Date() })
    .where(eq(briefs.id, briefId));
}

/** Where tapping a brief's notification goes: its chat, or the latest one if it was deleted. */
async function briefPath(db: Db, briefId: string): Promise<string> {
  const [row] = await db
    .select({ conversationId: chatMessages.conversationId })
    .from(briefs)
    .innerJoin(chatMessages, eq(briefs.chatMessageId, chatMessages.id))
    .where(eq(briefs.id, briefId));
  return row ? `/chat/${row.conversationId}` : "/chat";
}

/** The time zone from the user's brief settings, UTC if they have none. */
async function userTimeZone(db: Db, userId: string): Promise<string> {
  const [row] = await db
    .select({ timeZone: briefSettings.timeZone })
    .from(briefSettings)
    .where(eq(briefSettings.userId, userId));
  return row?.timeZone ?? "UTC";
}

async function loadSaved(
  db: Db,
  briefId: string,
): Promise<{ items: BriefItem[]; alerts: BriefAlert[] }> {
  const [row] = await db
    .select({ items: briefs.items, alerts: briefs.alerts })
    .from(briefs)
    .where(eq(briefs.id, briefId));
  return { items: row?.items ?? [], alerts: row?.alerts ?? [] };
}

function errorCode(err: unknown): string {
  const name = err instanceof Error ? err.name : "";
  if (name === "AniListUnavailableError") return "anilist_unavailable";
  if (name === "BriefPushError") return "push_failed";
  return "internal_error";
}

/**
 * Lets a changed brief time apply today: clears today's daily brief if it sent nothing (nothing
 * new had aired, or its time had passed). A brief that went out stays, so a day never gets two.
 */
export async function rearmToday(
  db: Db,
  userId: string,
  timeZone: string,
  now: Date = new Date(),
): Promise<void> {
  await db
    .delete(briefs)
    .where(
      and(
        eq(briefs.userId, userId),
        eq(briefs.kind, "daily"),
        eq(briefs.localDate, localClock(now, timeZone).date),
        inArray(briefs.status, ["empty", "skipped_late"]),
      ),
    );
}

export interface BriefSchedule {
  /** When the next daily brief goes out, or null when the brief is off. */
  next: "today" | "tomorrow" | null;
  /** The most recent daily brief, for the settings page. */
  lastDaily: {
    localDate: string;
    status: (typeof briefs.$inferSelect)["status"];
    episodes: number;
    started: number;
    at: string;
  } | null;
}

/** Where the user's daily brief stands, for the settings page. */
export async function briefSchedule(
  db: Db,
  userId: string,
  settings: { enabled: boolean; localTime: string; timeZone: string },
  now: Date = new Date(),
): Promise<BriefSchedule> {
  const [last] = await db
    .select()
    .from(briefs)
    .where(and(eq(briefs.userId, userId), eq(briefs.kind, "daily")))
    .orderBy(desc(briefs.createdAt))
    .limit(1);
  const lastDaily =
    last?.localDate != null
      ? {
          localDate: last.localDate,
          status: last.status,
          episodes: episodeCount(last.items ?? []),
          started: last.alerts.length,
          at: last.updatedAt.toISOString(),
        }
      : null;

  if (!settings.enabled) return { next: null, lastDaily };
  const timing = briefTiming(settings, now);
  if (!timing.due) return { next: "today", lastDaily };
  const doneToday = lastDaily?.localDate === timing.localDate;
  return { next: doneToday || timing.late ? "tomorrow" : "today", lastDaily };
}
