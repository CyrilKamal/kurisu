import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import type { FastifyBaseLogger } from "fastify";

import { airingRows, refreshAiring } from "../anilist/cache.js";
import type { AniListClient } from "../anilist/client.js";
import { currentConversation } from "../chat/service.js";
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
import { buildBriefItems, chatText, episodeCount, pushText, type BriefItem } from "./build.js";
import { writeSummary } from "./summary.js";
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
 * Builds and sends one brief: new episodes of the user's Watching shows since the last brief, as
 * a chat message and a push notification. A daily brief happens at most once per local date; a
 * retry picks up where the last attempt stopped and never posts the chat message twice.
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
  if (!brief) return { status: "skipped", briefId: null, episodes: 0, push: NO_PUSH };

  if (brief.status === "ready" && brief.items) {
    // A previous attempt saved the chat message but didn't get the push out.
    return deliver(deps, userId, brief.id, brief.items, request.kind);
  }

  try {
    const windowStart =
      request.kind === "daily"
        ? await dailyWindowStart(db, userId, brief.id, now)
        : new Date(now.getTime() - DEFAULT_WINDOW_MS);
    const items = await gatherItems(deps, userId, windowStart, now);
    const window = { windowStart, windowEnd: now, items };

    if (items.length === 0) {
      await update(db, brief.id, { ...window, status: "empty", error: null });
      return { status: "empty", briefId: brief.id, episodes: 0, push: NO_PUSH };
    }

    const summary = await writeSummary(deps.models, deps.model, items);
    if (summary.rejected) {
      deps.log.warn(
        { briefId: brief.id, reason: summary.rejected },
        "brief summary fell back to the template",
      );
    }
    await db.transaction(async (tx) => {
      const conversationId = await currentConversation(tx, userId);
      const [message] = await tx
        .insert(chatMessages)
        .values({ conversationId, role: "assistant", content: chatText(summary.text, items) })
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
  return deliver(deps, userId, brief.id, (await loadItems(db, brief.id)) ?? [], request.kind);
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
  kind: BriefRequest["kind"],
): Promise<BriefOutcome> {
  const push = await deps.push.sendToUser(userId, {
    ...pushText(items),
    url: "/chat",
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
  return { status: "sent", briefId, episodes: episodeCount(items), push };
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

/** The user's Watching shows with episodes that aired in the window. */
async function gatherItems(
  deps: BriefDeps,
  userId: string,
  windowStart: Date,
  windowEnd: Date,
): Promise<BriefItem[]> {
  const { db } = deps;
  const watching = await db
    .select({
      malId: anime.malId,
      title: anime.title,
      episodesWatched: listEntries.numEpisodesWatched,
      numEpisodes: anime.numEpisodes,
    })
    .from(listEntries)
    .innerJoin(anime, eq(anime.malId, listEntries.animeId))
    .where(and(eq(listEntries.userId, userId), eq(listEntries.status, "watching")));
  if (watching.length === 0) return [];

  const malIds = watching.map((w) => w.malId);
  const malIdByAniList = new Map<number, number>();
  let rows: Awaited<ReturnType<typeof airingRows>>;
  let aired: Awaited<ReturnType<AniListClient["airedBetween"]>>;
  try {
    await refreshAiring(deps, malIds, { now: windowEnd });
    rows = await airingRows(db, malIds);
    for (const row of rows.values()) {
      if (row.anilistId !== null) malIdByAniList.set(row.anilistId, row.malId);
    }
    aired = await deps.anilist.airedBetween([...malIdByAniList.keys()], windowStart, windowEnd);
  } catch (err) {
    throw new AniListUnavailableError({ cause: err });
  }

  const [settings] = await db
    .select({ services: briefSettings.services })
    .from(briefSettings)
    .where(eq(briefSettings.userId, userId));
  return buildBriefItems({
    watching,
    aired: aired.flatMap((a) => {
      const malId = malIdByAniList.get(a.anilistId);
      return malId === undefined ? [] : [{ malId, episode: a.episode, airedAt: a.airedAt }];
    }),
    links: new Map([...rows.values()].map((row) => [row.malId, row.streamingLinks])),
    services: settings?.services ?? [],
  });
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

async function loadItems(db: Db, briefId: string): Promise<BriefItem[] | null> {
  const [row] = await db.select({ items: briefs.items }).from(briefs).where(eq(briefs.id, briefId));
  return row?.items ?? null;
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
          at: last.updatedAt.toISOString(),
        }
      : null;

  if (!settings.enabled) return { next: null, lastDaily };
  const timing = briefTiming(settings, now);
  if (!timing.due) return { next: "today", lastDaily };
  const doneToday = lastDaily?.localDate === timing.localDate;
  return { next: doneToday || timing.late ? "tomorrow" : "today", lastDaily };
}
