import { and, desc, eq, getTableColumns, notInArray, sql, type SQL, type Table } from "drizzle-orm";
import type { FastifyBaseLogger } from "fastify";
import { ZodError } from "zod";

import { ReauthRequiredError, withMalAccessToken, type TokenStore } from "../auth/tokenStore.js";
import type { Db } from "../db/client.js";
import { anime, listEntries, syncRuns } from "../db/schema.js";
import {
  animeListFirstPageUrl,
  DEFAULT_RETRY,
  fetchAnimeListPage,
  MalApiError,
  MalResponseError,
  type MalAnimeListItem,
  type RetryOptions,
} from "../mal/client.js";
import { MalOAuthError } from "../mal/oauth.js";
import { toMirrorRows } from "./mirrorRows.js";

/** Minimum time between manual syncs per user. MAL's rate limits are undocumented. */
export const MANUAL_SYNC_COOLDOWN_MS = 60_000;

/** Safety stop for paging: 100 pages of 1000 is far beyond any real list. */
const MAX_PAGES = 100;
const INSERT_CHUNK = 500;

export type SyncTrigger = "login" | "manual";

/** Stored in sync_runs.error and returned to the web app. Never a raw error message. */
export type SyncErrorCode =
  "reauth_required" | "mal_unavailable" | "invalid_response" | "interrupted" | "internal_error";

export type SyncRun = typeof syncRuns.$inferSelect;

export interface ListSync {
  /** Mirrors the user's whole MAL anime list. Never throws for MAL failures; see the run row. */
  run(userId: string, trigger: SyncTrigger): Promise<SyncRun>;
  /** Marks runs left "running" by a previous process as interrupted. */
  recoverInterruptedRuns(): Promise<void>;
}

export function createListSync(deps: {
  db: Db;
  tokenStore: TokenStore;
  apiBaseUrl: string;
  log: FastifyBaseLogger;
  retry?: RetryOptions;
  /** Called after each successful sync, e.g. to refresh airing data. Must not throw. */
  afterSync?: (userId: string) => void;
}): ListSync {
  const { db, tokenStore, apiBaseUrl, log } = deps;
  const retry = deps.retry ?? DEFAULT_RETRY;
  const inflight = new Map<string, Promise<SyncRun>>();

  async function fetchWholeList(userId: string): Promise<MalAnimeListItem[]> {
    // Keyed by anime id: if the list changes while we page, MAL can repeat an item.
    const items = new Map<number, MalAnimeListItem>();
    let url: URL | null = animeListFirstPageUrl(apiBaseUrl);
    for (let page = 0; url; page++) {
      if (page >= MAX_PAGES) throw new MalResponseError(url.pathname, "too many pages");
      const pageUrl: URL = url;
      const result = await withMalAccessToken(tokenStore, userId, (token) =>
        fetchAnimeListPage(apiBaseUrl, pageUrl, token, retry),
      );
      for (const item of result.items) items.set(item.node.id, item);
      url = result.next;
    }
    return [...items.values()];
  }

  async function replaceMirror(userId: string, items: MalAnimeListItem[]): Promise<void> {
    const syncedAt = new Date();
    const rows = items.map((item) => toMirrorRows(item, userId, syncedAt));

    await db.transaction(async (tx) => {
      for (const chunk of chunks(
        rows.map((r) => r.anime),
        INSERT_CHUNK,
      )) {
        await tx
          .insert(anime)
          .values(chunk)
          .onConflictDoUpdate({ target: anime.malId, set: excludedSet(anime, chunk) });
      }
      for (const chunk of chunks(
        rows.map((r) => r.entry),
        INSERT_CHUNK,
      )) {
        await tx
          .insert(listEntries)
          .values(chunk)
          .onConflictDoUpdate({
            target: [listEntries.userId, listEntries.animeId],
            set: excludedSet(listEntries, chunk),
          });
      }
      // Anything no longer on MAL was removed there; remove it here too.
      const keep = rows.map((r) => r.entry.animeId);
      await tx
        .delete(listEntries)
        .where(
          keep.length > 0
            ? and(eq(listEntries.userId, userId), notInArray(listEntries.animeId, keep))
            : eq(listEntries.userId, userId),
        );
    });
  }

  async function doRun(userId: string, trigger: SyncTrigger): Promise<SyncRun> {
    const [started] = await db
      .insert(syncRuns)
      .values({ userId, trigger, status: "running" })
      .returning();
    if (!started) throw new Error("sync_runs insert returned no row");

    let finished: Partial<SyncRun>;
    try {
      const items = await fetchWholeList(userId);
      await replaceMirror(userId, items);
      finished = { status: "succeeded", entriesCount: items.length };
      log.info({ userId, trigger, entries: items.length }, "list sync succeeded");
      deps.afterSync?.(userId);
    } catch (err) {
      const error = classifySyncError(err);
      finished = { status: "failed", error };
      log.warn({ userId, trigger, error, err }, "list sync failed");
    }

    const [row] = await db
      .update(syncRuns)
      .set({ ...finished, finishedAt: new Date() })
      .where(eq(syncRuns.id, started.id))
      .returning();
    if (!row) throw new Error("sync_runs update returned no row");
    return row;
  }

  return {
    run(userId, trigger) {
      // One sync per user at a time; a second caller shares the running one.
      const existing = inflight.get(userId);
      if (existing) return existing;
      const pending = doRun(userId, trigger).finally(() => inflight.delete(userId));
      inflight.set(userId, pending);
      return pending;
    },

    async recoverInterruptedRuns() {
      await db
        .update(syncRuns)
        .set({ status: "failed", error: "interrupted", finishedAt: new Date() })
        .where(eq(syncRuns.status, "running"));
    },
  };
}

export async function latestSyncRun(db: Db, userId: string): Promise<SyncRun | null> {
  const [row] = await db
    .select()
    .from(syncRuns)
    .where(eq(syncRuns.userId, userId))
    .orderBy(desc(syncRuns.startedAt))
    .limit(1);
  return row ?? null;
}

export function classifySyncError(err: unknown): SyncErrorCode {
  if (err instanceof ReauthRequiredError) return "reauth_required";
  if (err instanceof MalResponseError || err instanceof ZodError) return "invalid_response";
  if (err instanceof MalApiError || err instanceof MalOAuthError) return "mal_unavailable";
  // fetch() network failures and timeouts
  if (err instanceof TypeError || (err instanceof DOMException && err.name === "TimeoutError")) {
    return "mal_unavailable";
  }
  return "internal_error";
}

/** `SET col = excluded.col` for every column present in the rows being upserted. */
function excludedSet(table: Table, rows: object[]): Record<string, SQL> {
  const columns: Record<string, { name: string }> = getTableColumns(table);
  const set: Record<string, SQL> = {};
  const first = rows[0];
  if (!first) return set;
  for (const key of Object.keys(first)) {
    const column = columns[key];
    if (column) set[key] = sql.raw(`excluded."${column.name}"`);
  }
  return set;
}

function* chunks<T>(items: T[], size: number): Generator<T[]> {
  for (let i = 0; i < items.length; i += size) yield items.slice(i, i + size);
}
