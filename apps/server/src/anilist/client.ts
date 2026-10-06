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

/**
 * One MAL entry's AniList data. Episode numbers are MAL's: when AniList splits a show MAL keeps
 * as one entry (Steel Ball Run's "1st STAGE" and "2nd & 3rd STAGE"), the parts are joined end to
 * end and this describes the latest part, with its episodes shifted by `episodeOffset`.
 */
export interface AniListMedia {
  /** The AniList entry that's airing now (the latest part of a split show). */
  anilistId: number;
  malId: number;
  /** AniList values like RELEASING, FINISHED, NOT_YET_RELEASED. */
  status: string | null;
  episodes: number | null;
  nextEpisode: { episode: number; airingAt: Date } | null;
  streamingLinks: StreamingLink[];
  /** Add to AniList's episode numbers for `anilistId` to get MAL's. 0 unless the show is split. */
  episodeOffset: number;
}

/** What MAL itself says about an entry, to check how AniList's parts of a split show line up. */
export interface MalFacts {
  /** "2026-03-19", or partial ("2026-03") when MAL isn't sure. */
  startDate: string | null;
  numEpisodes: number | null;
}

export interface MediaLookup {
  media: AniListMedia[];
  /**
   * MAL ids whose AniList parts can't be lined up with MAL's entry safely (see joinParts), so their
   * episode numbers are unknown.
   */
  unjoinable: number[];
}

export interface AiredEpisode {
  anilistId: number;
  episode: number;
  airedAt: Date;
}

export interface AniListClient {
  /** AniList data for these MAL ids. Ids AniList doesn't know are simply missing. */
  mediaByMalIds(malIds: number[], malFacts?: ReadonlyMap<number, MalFacts>): Promise<MediaLookup>;
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
      format
      status
      episodes
      startDate { year month day }
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
        format: z.string().nullish(),
        status: z.string().nullish(),
        startDate: z
          .object({
            year: z.number().int().nullish(),
            month: z.number().int().nullish(),
            day: z.number().int().nullish(),
          })
          .nullish(),
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
    async mediaByMalIds(malIds, malFacts) {
      const media = await paged(malIds, MEDIA_QUERY, {}, mediaPageSchema, (data) => ({
        items: data.Page.media,
        hasNextPage: data.Page.pageInfo.hasNextPage === true,
      }));
      const parts = new Map<number, RawMedia[]>();
      for (const m of media) {
        if (!m.idMal) continue;
        parts.set(m.idMal, [...(parts.get(m.idMal) ?? []), m]);
      }
      const result: MediaLookup = { media: [], unjoinable: [] };
      for (const [malId, entries] of parts) {
        const joined = joinParts(malId, entries, malFacts?.get(malId));
        if (joined) result.media.push(joined);
        else result.unjoinable.push(malId);
      }
      return result;
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

type RawMedia = z.infer<typeof mediaPageSchema>["Page"]["media"][number];

/** Formats whose episodes MAL counts as one series. Specials and movies aren't joined. */
const SERIES_FORMATS = ["TV", "TV_SHORT", "ONA"];

/** AniList and MAL can disagree by a day or so on a premiere date (time zones). */
const SAME_START_DAYS = 2;

/**
 * One MAL entry from its AniList parts. A single part is used as is.
 *
 * Several parts (Steel Ball Run's "1st STAGE" and "2nd & 3rd STAGE") are lined up with MAL's
 * entry by its start date: MAL's entry covers the part that started then and every later one,
 * numbered straight through, so each earlier covered part's episodes shift the latest part's
 * numbers. When MAL knows the total, the covered parts must add up to it. Anything ambiguous
 * returns null: a part that isn't a series or has no full start date, no full MAL start date,
 * no part (or more than one) starting then, an earlier covered part still airing or without an
 * episode count, or a total that doesn't add up.
 */
export function joinParts(malId: number, parts: RawMedia[], mal?: MalFacts): AniListMedia | null {
  const only = parts.length === 1 ? parts[0] : undefined;
  if (only) return toMedia(malId, only, 0, streamingLinks([only]));

  const malStart = fullDate(mal?.startDate ?? null);
  if (!malStart) return null;
  if (parts.some((p) => !SERIES_FORMATS.includes(p.format ?? "") || !partStart(p))) return null;
  const sorted = [...parts].sort((a, b) => startKey(a) - startKey(b));
  const starts = sorted.map((p) => partStart(p) ?? 0);
  const matches = starts.flatMap((start, i) =>
    Math.abs(start - malStart) <= SAME_START_DAYS * DAY_MS ? [i] : [],
  );
  const [first] = matches;
  if (matches.length !== 1 || first === undefined) return null;

  const covered = sorted.slice(first);
  const latest = covered.at(-1);
  const earlier = covered.slice(0, -1);
  if (!latest || earlier.some((p) => p.status !== "FINISHED" || p.episodes == null)) return null;
  const offset = earlier.reduce((sum, p) => sum + (p.episodes ?? 0), 0);
  if (mal?.numEpisodes != null && latest.episodes != null) {
    if (offset + latest.episodes !== mal.numEpisodes) return null;
  }
  return toMedia(malId, latest, offset, streamingLinks([latest, ...earlier]));
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** A part's start date as a UTC timestamp, or null unless year, month and day are known. */
function partStart(m: RawMedia): number | null {
  const d = m.startDate;
  if (!d?.year || !d.month || !d.day) return null;
  return Date.UTC(d.year, d.month - 1, d.day);
}

/** MAL's "2026-03-19" as a UTC timestamp; null for partial dates like "2026-03". */
function fullDate(value: string | null): number | null {
  const match = value ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(value) : null;
  if (!match) return null;
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function toMedia(malId: number, m: RawMedia, offset: number, links: StreamingLink[]): AniListMedia {
  return {
    anilistId: m.id,
    malId,
    status: m.status ?? null,
    episodes: m.episodes == null ? null : m.episodes + offset,
    nextEpisode: m.nextAiringEpisode
      ? {
          episode: m.nextAiringEpisode.episode + offset,
          airingAt: new Date(m.nextAiringEpisode.airingAt * 1000),
        }
      : null,
    streamingLinks: links,
    episodeOffset: offset,
  };
}

/** Enabled official streaming links of these parts, one per service. */
function streamingLinks(parts: RawMedia[]): StreamingLink[] {
  const bySite = new Map<number, StreamingLink>();
  for (const part of parts) {
    for (const link of part.externalLinks ?? []) {
      if (link.type !== "STREAMING" || link.isDisabled || !link.siteId || !link.url) continue;
      if (!bySite.has(link.siteId)) {
        bySite.set(link.siteId, { siteId: link.siteId, site: link.site, url: link.url });
      }
    }
  }
  return [...bySite.values()];
}

function startKey(m: RawMedia): number {
  return (
    (m.startDate?.year ?? 0) * 10_000 + (m.startDate?.month ?? 0) * 100 + (m.startDate?.day ?? 0)
  );
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
