import { z } from "zod";

import { backoffDelay, DEFAULT_RETRY, type RetryOptions } from "../mal/client.js";

// AniList's public GraphQL API: airing schedules and streaming links, keyed by MAL id. No auth.

/** An official streaming link from AniList (AniList only lists licensed services). */
export interface StreamingLink {
  /** AniList's id for the service, e.g. 5 = Crunchyroll. */
  siteId: number;
  site: string;
  url: string;
}

export interface AniListMedia {
  anilistId: number;
  malId: number;
  /** AniList values like RELEASING, FINISHED, NOT_YET_RELEASED. */
  status: string | null;
  episodes: number | null;
  nextEpisode: { episode: number; airingAt: Date } | null;
  streamingLinks: StreamingLink[];
}

export interface AiredEpisode {
  anilistId: number;
  episode: number;
  airedAt: Date;
}

export interface AniListClient {
  /** AniList entries for these MAL ids. Ids AniList doesn't know are simply missing. */
  mediaByMalIds(malIds: number[]): Promise<AniListMedia[]>;
  /** Episodes of these shows that aired after `from`, up to and including `to`. */
  airedBetween(anilistIds: number[], from: Date, to: Date): Promise<AiredEpisode[]>;
}

/** A non-2xx response from AniList. */
export class AniListApiError extends Error {
  constructor(readonly status: number) {
    super(`AniList API returned ${String(status)}`);
    this.name = "AniListApiError";
  }
}

/** AniList answered with GraphQL errors or a shape we can't use. */
export class AniListResponseError extends Error {
  constructor(reason: string) {
    super(`AniList API: ${reason}`);
    this.name = "AniListResponseError";
  }
}

export const DEFAULT_ANILIST_API_URL = "https://graphql.anilist.co";

/**
 * AniList allows 90 requests a minute, currently lowered to 30. Spacing requests 3 s apart
 * (20 a minute) stays under the lower limit.
 */
const DEFAULT_MIN_INTERVAL_MS = 3_000;
/** Ids per request; AniList pages hold at most 50 items. */
const BATCH_SIZE = 50;
/** A guard against a paging bug looping forever. */
const MAX_PAGES = 20;

const MEDIA_QUERY = `query ($ids: [Int], $page: Int) {
  Page(page: $page, perPage: 50) {
    pageInfo { hasNextPage }
    media(idMal_in: $ids, type: ANIME) {
      id
      idMal
      status
      episodes
      nextAiringEpisode { episode airingAt }
      externalLinks { siteId site url type isDisabled }
    }
  }
}`;

const AIRED_QUERY = `query ($ids: [Int], $after: Int, $before: Int, $page: Int) {
  Page(page: $page, perPage: 50) {
    pageInfo { hasNextPage }
    airingSchedules(mediaId_in: $ids, airingAt_greater: $after, airingAt_lesser: $before, sort: TIME) {
      mediaId
      episode
      airingAt
    }
  }
}`;

const pageInfoSchema = z.object({ hasNextPage: z.boolean().nullish() });

const mediaPageSchema = z.object({
  Page: z.object({
    pageInfo: pageInfoSchema,
    media: z.array(
      z.object({
        id: z.number().int().positive(),
        idMal: z.number().int().positive().nullish(),
        status: z.string().nullish(),
        episodes: z.number().int().nonnegative().nullish(),
        nextAiringEpisode: z
          .object({ episode: z.number().int().positive(), airingAt: z.number().int() })
          .nullish(),
        externalLinks: z
          .array(
            z.object({
              siteId: z.number().int().nullish(),
              site: z.string(),
              url: z.string().nullish(),
              type: z.string().nullish(),
              isDisabled: z.boolean().nullish(),
            }),
          )
          .nullish(),
      }),
    ),
  }),
});

const airedPageSchema = z.object({
  Page: z.object({
    pageInfo: pageInfoSchema,
    airingSchedules: z.array(
      z.object({
        mediaId: z.number().int().positive(),
        episode: z.number().int().positive(),
        airingAt: z.number().int(),
      }),
    ),
  }),
});

const responseSchema = z.object({
  data: z.unknown().nullish(),
  errors: z.array(z.object({ message: z.string().optional() })).nullish(),
});

export interface AniListClientOptions {
  apiUrl: string;
  retry?: RetryOptions;
  /** Minimum time between requests. Tests set 0. */
  minIntervalMs?: number;
}

export function createAniListClient(options: AniListClientOptions): AniListClient {
  const retry = options.retry ?? DEFAULT_RETRY;
  const waitTurn = spacing(options.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS);

  async function query<T>(
    text: string,
    variables: Record<string, unknown>,
    schema: z.ZodType<T>,
  ): Promise<T> {
    const data = await requestJson(options.apiUrl, { query: text, variables }, retry, waitTurn);
    const parsed = schema.safeParse(data);
    if (!parsed.success) throw new AniListResponseError("unexpected response shape");
    return parsed.data;
  }

  /** Runs one paged query per batch of ids and collects every page. */
  async function paged<T, Item>(
    ids: number[],
    text: string,
    variables: Record<string, unknown>,
    schema: z.ZodType<T>,
    items: (page: T) => { items: Item[]; hasNextPage: boolean },
  ): Promise<Item[]> {
    const all: Item[] = [];
    for (const batch of chunks([...new Set(ids)], BATCH_SIZE)) {
      for (let page = 1; page <= MAX_PAGES; page++) {
        const result = items(await query(text, { ...variables, ids: batch, page }, schema));
        all.push(...result.items);
        if (!result.hasNextPage) break;
      }
    }
    return all;
  }

  return {
    async mediaByMalIds(malIds) {
      const media = await paged(malIds, MEDIA_QUERY, {}, mediaPageSchema, (data) => ({
        items: data.Page.media,
        hasNextPage: data.Page.pageInfo.hasNextPage === true,
      }));
      const byMalId = new Map<number, AniListMedia>();
      for (const m of media) {
        // AniList can hold more than one entry with the same MAL id; the first one wins.
        if (!m.idMal || byMalId.has(m.idMal)) continue;
        byMalId.set(m.idMal, {
          anilistId: m.id,
          malId: m.idMal,
          status: m.status ?? null,
          episodes: m.episodes ?? null,
          nextEpisode: m.nextAiringEpisode
            ? {
                episode: m.nextAiringEpisode.episode,
                airingAt: new Date(m.nextAiringEpisode.airingAt * 1000),
              }
            : null,
          streamingLinks: (m.externalLinks ?? []).flatMap((link) =>
            link.type === "STREAMING" && !link.isDisabled && link.siteId && link.url
              ? [{ siteId: link.siteId, site: link.site, url: link.url }]
              : [],
          ),
        });
      }
      return [...byMalId.values()];
    },

    async airedBetween(anilistIds, from, to) {
      // AniList's bounds are exclusive; `before` is one second past `to` to include it.
      const variables = { after: unixSeconds(from), before: unixSeconds(to) + 1 };
      const aired = await paged(anilistIds, AIRED_QUERY, variables, airedPageSchema, (data) => ({
        items: data.Page.airingSchedules,
        hasNextPage: data.Page.pageInfo.hasNextPage === true,
      }));
      return aired.map((a) => ({
        anilistId: a.mediaId,
        episode: a.episode,
        airedAt: new Date(a.airingAt * 1000),
      }));
    },
  };
}

/** One GraphQL request, retried on 429, 5xx and network errors. Returns `data`. */
async function requestJson(
  apiUrl: string,
  body: { query: string; variables: Record<string, unknown> },
  retry: RetryOptions,
  waitTurn: () => Promise<void>,
): Promise<unknown> {
  for (let attempt = 0; ; attempt++) {
    await waitTurn();
    let res: Response;
    try {
      res = await fetch(apiUrl, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (err) {
      if (attempt < retry.retries) {
        await sleep(backoffDelay(attempt, retry));
        continue;
      }
      throw err;
    }

    if (res.ok) {
      const parsed = responseSchema.safeParse(await res.json());
      if (!parsed.success) throw new AniListResponseError("not a GraphQL response");
      if (parsed.data.errors?.length) {
        throw new AniListResponseError(parsed.data.errors[0]?.message ?? "GraphQL error");
      }
      return parsed.data.data;
    }

    const retryable = res.status === 429 || res.status >= 500;
    await res.body?.cancel();
    if (retryable && attempt < retry.retries) {
      await sleep(backoffDelay(attempt, retry, res.headers.get("retry-after")));
      continue;
    }
    throw new AniListApiError(res.status);
  }
}

/** Returns a function that resolves once at least `intervalMs` has passed since the last call. */
function spacing(intervalMs: number): () => Promise<void> {
  let nextAt = 0;
  return async () => {
    const now = Date.now();
    const wait = Math.max(0, nextAt - now);
    nextAt = Math.max(now, nextAt) + intervalMs;
    if (wait > 0) await sleep(wait);
  };
}

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function unixSeconds(date: Date): number {
  return Math.floor(date.getTime() / 1000);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
