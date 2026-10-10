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

/** A show from AniList's catalog, found by title. */
export interface CatalogShow {
  anilistId: number;
  /** Null when AniList doesn't know the MAL entry; such shows can't be added. */
  malId: number | null;
  /** Romaji, as MAL titles are. */
  title: string;
  titleEn: string | null;
  titleJa: string | null;
  synonyms: string[];
  /** AniList values like TV, MOVIE, ONA. */
  format: string | null;
  /** AniList values like FINISHED, RELEASING, NOT_YET_RELEASED. */
  status: string | null;
  episodes: number | null;
  /** Minutes per episode. */
  duration: number | null;
  coverUrl: string | null;
  /** "2023-09-29", or partial ("2027-10") when AniList isn't sure. */
  startDate: string | null;
}

/** A show with what discovery ranks and filters it by. */
export interface DiscoveredShow extends CatalogShow {
  /** AniList's genres. */
  genres: string[];
  /** AniList's tags, with how central each is (0–100). */
  tags: { name: string; rank: number | null; isMediaSpoiler: boolean | null }[];
  /** AniList's average score, 0–100. */
  averageScore: number | null;
  popularity: number | null;
  isAdult: boolean;
  /** The entries this one follows, by MAL id. */
  prequelMalIds: number[];
  /** Where it streams officially. */
  streamingLinks: StreamingLink[];
}

/** A show that follows another (AniList's SEQUEL relation), with where it streams. */
export interface SequelShow extends CatalogShow {
  isAdult: boolean;
  streamingLinks: StreamingLink[];
}

/** One "fans also liked" link: a show AniList users recommend to fans of a seed show. */
export interface FanRecommendation {
  seedMalId: number;
  anilistId: number;
  /** 0 for the most recommended show for that seed. */
  rank: number;
}

/** An anime season, as AniList names them. */
export type AniListSeason = "WINTER" | "SPRING" | "SUMMER" | "FALL";

/** A season's lineup to fetch: its series, most popular first; `airing` keeps those still airing. */
export interface SeasonList {
  season: AniListSeason;
  year: number;
  airing?: boolean;
}

/** A top-rated list to fetch: by AniList genre, tag or format. */
export interface TopList {
  key: string;
  genre?: string;
  tag?: string;
  format?: string;
}

export interface AniListClient {
  /** AniList data for these MAL ids. Ids AniList doesn't know are simply missing. */
  mediaByMalIds(malIds: number[], malFacts?: ReadonlyMap<number, MalFacts>): Promise<MediaLookup>;
  /** Episodes of these shows that aired after `from`, up to and including `to`. */
  airedBetween(anilistIds: number[], from: Date, to: Date): Promise<AiredEpisode[]>;
  /**
   * Shows matching each title, best match first, in one request. Adult titles are left out.
   * Results of all queries come back together, without repeats.
   */
  searchAnime(queries: string[]): Promise<CatalogShow[]>;
  /** For each seed show, the shows its fans most recommend, best first. */
  fansAlsoLiked(seedMalIds: number[]): Promise<FanRecommendation[]>;
  /** The top-rated, reasonably popular shows of each list, best first, as AniList ids. */
  topRated(lists: TopList[]): Promise<Map<string, number[]>>;
  /** Full details of these shows, by AniList id. Ids AniList doesn't know are missing. */
  showDetails(anilistIds: number[]): Promise<DiscoveredShow[]>;
  /**
   * The series (TV, TV short, ONA) of these seasons, most popular first, as AniList ids: one list
   * per season asked for, in one request. Adult titles are left out.
   */
  seasonLineup(lists: SeasonList[]): Promise<number[][]>;
  /**
   * The anime that follow each of these MAL entries (AniList's SEQUEL relations), by MAL id.
   * Ids AniList doesn't know are missing; a known show with no sequel maps to [].
   */
  sequelsOf(malIds: number[]): Promise<Map<number, SequelShow[]>>;
  /**
   * AniList's description of each MAL entry, as AniList writes it (with <br> and other markup),
   * or null when it has none. For a show AniList splits into parts, the first part's. Ids AniList
   * doesn't know are missing.
   */
  descriptions(malIds: number[]): Promise<Map<number, string | null>>;
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
 * (20 a minute) stays under the lower limit, as long as the whole server shares one pacer.
 */
export const DEFAULT_MIN_INTERVAL_MS = 3_000;
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

/** Results per title in a search. */
const SEARCH_PER_QUERY = 8;
/** Titles per search request. */
export const MAX_SEARCH_QUERIES = 3;

const SEARCH_FIELDS = `id idMal title { romaji english native } synonyms format status episodes
  duration isAdult coverImage { large } startDate { year month day }`;

/** One aliased page per title ($q0, $q1, ...), so a search is a single request. */
function searchQuery(count: number): string {
  const indexes = Array.from({ length: count }, (_, i) => String(i));
  const pages = indexes.map(
    (i) =>
      `q${i}: Page(perPage: ${String(SEARCH_PER_QUERY)}) { media(search: $q${i}, type: ANIME, isAdult: false, sort: [SEARCH_MATCH]) { ${SEARCH_FIELDS} } }`,
  );
  return `query (${indexes.map((i) => `$q${i}: String`).join(", ")}) { ${pages.join(" ")} }`;
}

const externalLinksSchema = z
  .array(
    z.object({
      siteId: z.number().int().nullish(),
      site: z.string(),
      url: z.string().nullish(),
      type: z.string().nullish(),
      isDisabled: z.boolean().nullish(),
    }),
  )
  .nullish();

const searchMediaSchema = z.object({
  id: z.number().int().positive(),
  idMal: z.number().int().positive().nullish(),
  title: z.object({
    romaji: z.string().nullish(),
    english: z.string().nullish(),
    native: z.string().nullish(),
  }),
  synonyms: z.array(z.string()).nullish(),
  format: z.string().nullish(),
  status: z.string().nullish(),
  episodes: z.number().int().nonnegative().nullish(),
  duration: z.number().int().nonnegative().nullish(),
  isAdult: z.boolean().nullish(),
  coverImage: z.object({ large: z.string().nullish() }).nullish(),
  startDate: z
    .object({
      year: z.number().int().nullish(),
      month: z.number().int().nullish(),
      day: z.number().int().nullish(),
    })
    .nullish(),
});
const searchPagesSchema = z.record(z.string(), z.object({ media: z.array(searchMediaSchema) }));

/** Seeds per "fans also liked" request, and recommendations kept per seed. */
const SEEDS_PER_REQUEST = 10;
export const RECOMMENDATIONS_PER_SEED = 8;
/** Shows per top-rated list. */
export const TOP_LIST_SIZE = 50;
/** Top-rated lists skip shows fewer people have on their lists than this. */
const MIN_POPULARITY = 5000;

const FANS_QUERY = `query ($ids: [Int]) {
  Page(perPage: ${String(SEEDS_PER_REQUEST)}) {
    media(idMal_in: $ids, type: ANIME) {
      idMal
      recommendations(sort: [RATING_DESC], perPage: ${String(RECOMMENDATIONS_PER_SEED)}) {
        nodes { rating mediaRecommendation { id } }
      }
    }
  }
}`;

const fansSchema = z.object({
  Page: z.object({
    media: z.array(
      z.object({
        idMal: z.number().int().positive().nullish(),
        recommendations: z
          .object({
            nodes: z.array(
              z.object({
                rating: z.number().int().nullish(),
                mediaRecommendation: z.object({ id: z.number().int().positive() }).nullish(),
              }),
            ),
          })
          .nullish(),
      }),
    ),
  }),
});

/** One aliased page per list, so all the lists are a single request. */
function topQuery(lists: TopList[]): string {
  const pages = lists.map((list, i) => {
    const filters = [
      list.genre ? `genre_in: [${JSON.stringify(list.genre)}]` : null,
      list.tag ? `tag_in: [${JSON.stringify(list.tag)}]` : null,
      list.format ? `format_in: [${list.format}]` : null,
    ].filter(Boolean);
    return `l${String(i)}: Page(perPage: ${String(TOP_LIST_SIZE)}) { media(type: ANIME, ${filters.join(", ")}, isAdult: false, status_in: [FINISHED, RELEASING], sort: [SCORE_DESC], popularity_greater: ${String(MIN_POPULARITY)}) { id } }`;
  });
  return `query { ${pages.join(" ")} }`;
}

/** Shows per season lineup. */
export const SEASON_LIST_SIZE = 50;

/** One aliased page per season, so a lineup is a single request. */
function seasonQuery(lists: SeasonList[]): string {
  const pages = lists.map((list, i) => {
    const filters = [
      `season: ${list.season}`,
      `seasonYear: ${String(list.year)}`,
      ...(list.airing ? ["status: RELEASING"] : []),
    ];
    return `s${String(i)}: Page(perPage: ${String(SEASON_LIST_SIZE)}) { media(type: ANIME, ${filters.join(", ")}, isAdult: false, format_in: [TV, TV_SHORT, ONA], sort: [POPULARITY_DESC]) { id } }`;
  });
  return `query { ${pages.join(" ")} }`;
}

const topSchema = z.record(
  z.string(),
  z.object({ media: z.array(z.object({ id: z.number().int().positive() })) }),
);

const DETAILS_QUERY = `query ($ids: [Int], $page: Int) {
  Page(page: $page, perPage: 50) {
    pageInfo { hasNextPage }
    media(id_in: $ids, type: ANIME) {
      ${SEARCH_FIELDS}
      genres
      tags { name rank isMediaSpoiler }
      averageScore
      popularity
      relations { edges { relationType node { idMal type } } }
      externalLinks { siteId site url type isDisabled }
    }
  }
}`;

const DESCRIPTIONS_QUERY = `query ($ids: [Int], $page: Int) {
  Page(page: $page, perPage: 50) {
    pageInfo { hasNextPage }
    media(idMal_in: $ids, type: ANIME, sort: [START_DATE]) { idMal description(asHtml: false) }
  }
}`;

const descriptionsPageSchema = z.object({
  Page: z.object({
    pageInfo: z.object({ hasNextPage: z.boolean().nullish() }),
    media: z.array(
      z.object({ idMal: z.number().int().positive().nullish(), description: z.string().nullish() }),
    ),
  }),
});

const SEQUELS_QUERY = `query ($ids: [Int], $page: Int) {
  Page(page: $page, perPage: 50) {
    pageInfo { hasNextPage }
    media(idMal_in: $ids, type: ANIME) {
      idMal
      relations {
        edges {
          relationType
          node { type ${SEARCH_FIELDS} externalLinks { siteId site url type isDisabled } }
        }
      }
    }
  }
}`;

const detailsSchema = z.object({
  Page: z.object({
    pageInfo: z.object({ hasNextPage: z.boolean().nullish() }),
    media: z.array(
      searchMediaSchema.extend({
        genres: z.array(z.string()).nullish(),
        tags: z
          .array(
            z.object({
              name: z.string(),
              rank: z.number().int().nullish(),
              isMediaSpoiler: z.boolean().nullish(),
            }),
          )
          .nullish(),
        averageScore: z.number().int().nullish(),
        popularity: z.number().int().nullish(),
        relations: z
          .object({
            edges: z.array(
              z.object({
                relationType: z.string().nullish(),
                node: z
                  .object({
                    idMal: z.number().int().positive().nullish(),
                    type: z.string().nullish(),
                  })
                  .nullish(),
              }),
            ),
          })
          .nullish(),
        externalLinks: externalLinksSchema,
      }),
    ),
  }),
});

const pageInfoSchema = z.object({ hasNextPage: z.boolean().nullish() });

const sequelsPageSchema = z.object({
  Page: z.object({
    pageInfo: pageInfoSchema,
    media: z.array(
      z.object({
        idMal: z.number().int().positive().nullish(),
        relations: z
          .object({
            edges: z.array(
              z.object({
                relationType: z.string().nullish(),
                node: searchMediaSchema
                  .extend({ type: z.string().nullish(), externalLinks: externalLinksSchema })
                  .nullish(),
              }),
            ),
          })
          .nullish(),
      }),
    ),
  }),
});

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
        externalLinks: externalLinksSchema,
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
  /** Minimum time between requests, when the client has its own pacer. Tests set 0. */
  minIntervalMs?: number;
  /** A pacer shared with the server's other AniList clients, so together they stay under the limit. */
  pacer?: AniListPacer;
  /** Someone is waiting on these requests (a chat search): they go ahead of background ones. */
  urgent?: boolean;
}

export function createAniListClient(options: AniListClientOptions): AniListClient {
  const retry = options.retry ?? DEFAULT_RETRY;
  const pacer =
    options.pacer ?? createAniListPacer(options.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS);
  const urgent = options.urgent ?? false;
  const waitTurn = () => pacer.wait(urgent);

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

    async searchAnime(queries) {
      const titles = [...new Set(queries.map((q) => q.trim()).filter(Boolean))].slice(
        0,
        MAX_SEARCH_QUERIES,
      );
      if (titles.length === 0) return [];
      const variables = Object.fromEntries(titles.map((t, i) => [`q${String(i)}`, t]));
      const pages = await query(searchQuery(titles.length), variables, searchPagesSchema);
      const seen = new Set<number>();
      const shows: CatalogShow[] = [];
      for (let i = 0; i < titles.length; i++) {
        for (const m of pages[`q${String(i)}`]?.media ?? []) {
          // The query already asks for isAdult: false; checked again in case AniList ignores it.
          if (m.isAdult === true || seen.has(m.id)) continue;
          seen.add(m.id);
          shows.push(toCatalogShow(m));
        }
      }
      return shows;
    },

    async fansAlsoLiked(seedMalIds) {
      const out: FanRecommendation[] = [];
      for (const batch of chunks([...new Set(seedMalIds)], SEEDS_PER_REQUEST)) {
        const data = await query(FANS_QUERY, { ids: batch }, fansSchema);
        for (const seed of data.Page.media) {
          if (!seed.idMal) continue;
          const nodes = (seed.recommendations?.nodes ?? []).filter(
            (n) => n.mediaRecommendation && (n.rating ?? 0) > 0,
          );
          nodes.forEach((n, rank) => {
            if (n.mediaRecommendation && seed.idMal) {
              out.push({ seedMalId: seed.idMal, anilistId: n.mediaRecommendation.id, rank });
            }
          });
        }
      }
      return out;
    },

    async topRated(lists) {
      if (lists.length === 0) return new Map();
      const pages = await query(topQuery(lists), {}, topSchema);
      return new Map(
        lists.map((list, i) => [list.key, (pages[`l${String(i)}`]?.media ?? []).map((m) => m.id)]),
      );
    },

    async showDetails(anilistIds) {
      const media = await paged(anilistIds, DETAILS_QUERY, {}, detailsSchema, (data) => ({
        items: data.Page.media,
        hasNextPage: data.Page.pageInfo.hasNextPage === true,
      }));
      return media.map((m) => ({
        ...toCatalogShow(m),
        genres: m.genres ?? [],
        tags: (m.tags ?? []).map((t) => ({
          name: t.name,
          rank: t.rank ?? null,
          isMediaSpoiler: t.isMediaSpoiler ?? null,
        })),
        averageScore: m.averageScore ?? null,
        popularity: m.popularity ?? null,
        isAdult: m.isAdult === true,
        prequelMalIds: (m.relations?.edges ?? []).flatMap((e) =>
          e.relationType === "PREQUEL" && e.node?.type === "ANIME" && e.node.idMal
            ? [e.node.idMal]
            : [],
        ),
        streamingLinks: streamingLinks([m]),
      }));
    },

    async seasonLineup(lists) {
      if (lists.length === 0) return [];
      const pages = await query(seasonQuery(lists), {}, topSchema);
      return lists.map((_, i) => (pages[`s${String(i)}`]?.media ?? []).map((m) => m.id));
    },

    async sequelsOf(malIds) {
      const media = await paged(malIds, SEQUELS_QUERY, {}, sequelsPageSchema, (data) => ({
        items: data.Page.media,
        hasNextPage: data.Page.pageInfo.hasNextPage === true,
      }));
      const out = new Map<number, SequelShow[]>();
      for (const m of media) {
        if (!m.idMal) continue;
        const prequel = m.idMal;
        const found = out.get(prequel) ?? [];
        for (const edge of m.relations?.edges ?? []) {
          const node = edge.node;
          // One part of a show AniList splits is the sequel of another part of the same MAL entry.
          if (edge.relationType !== "SEQUEL" || node?.type !== "ANIME" || node.idMal === prequel) {
            continue;
          }
          if (found.some((s) => s.anilistId === node.id)) continue;
          found.push({
            ...toCatalogShow(node),
            isAdult: node.isAdult === true,
            streamingLinks: streamingLinks([node]),
          });
        }
        out.set(prequel, found);
      }
      return out;
    },

    async descriptions(malIds) {
      const media = await paged(malIds, DESCRIPTIONS_QUERY, {}, descriptionsPageSchema, (data) => ({
        items: data.Page.media,
        hasNextPage: data.Page.pageInfo.hasNextPage === true,
      }));
      const out = new Map<number, string | null>();
      // Earliest part first, so a split show gets its first part's description.
      for (const m of media) {
        if (!m.idMal) continue;
        const text = m.description?.trim() ? m.description : null;
        if (!out.has(m.idMal) || (out.get(m.idMal) === null && text !== null)) {
          out.set(m.idMal, text);
        }
      }
      return out;
    },
  };
}

/** "2023-09-29", "2027-10" or "2027", as MAL writes dates; null without a year. */
function partialDate(
  d: { year?: number | null; month?: number | null; day?: number | null } | null | undefined,
): string | null {
  if (!d?.year) return null;
  const pad = (n: number) => String(n).padStart(2, "0");
  if (!d.month) return String(d.year);
  return d.day
    ? `${String(d.year)}-${pad(d.month)}-${pad(d.day)}`
    : `${String(d.year)}-${pad(d.month)}`;
}

function positiveOrNull(value: number | null | undefined): number | null {
  return value != null && value > 0 ? value : null;
}

function toCatalogShow(m: z.infer<typeof searchMediaSchema>): CatalogShow {
  const startDate = partialDate(m.startDate);
  return {
    anilistId: m.id,
    malId: m.idMal ?? null,
    title: m.title.romaji ?? m.title.english ?? m.title.native ?? `AniList ${String(m.id)}`,
    titleEn: m.title.english ?? null,
    titleJa: m.title.native ?? null,
    synonyms: m.synonyms ?? [],
    format: m.format ?? null,
    status: m.status ?? null,
    // AniList sends 0 or null when it doesn't know.
    episodes: positiveOrNull(m.episodes),
    duration: positiveOrNull(m.duration),
    coverUrl: m.coverImage?.large ?? null,
    startDate,
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
function streamingLinks(
  parts: { externalLinks?: z.infer<typeof externalLinksSchema> }[],
): StreamingLink[] {
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
/** Hands out turns to send an AniList request, at least an interval apart. */
export interface AniListPacer {
  /** Resolves when it's this request's turn. Urgent requests go before waiting background ones. */
  wait(urgent: boolean): Promise<void>;
}

export function createAniListPacer(intervalMs: number): AniListPacer {
  const waiting: { urgent: boolean; go: () => void }[] = [];
  let lastAt = Number.NEGATIVE_INFINITY;
  let timer: NodeJS.Timeout | null = null;

  function next(): void {
    if (timer !== null || waiting.length === 0) return;
    timer = setTimeout(
      () => {
        timer = null;
        const urgentAt = waiting.findIndex((turn) => turn.urgent);
        const [turn] = waiting.splice(urgentAt === -1 ? 0 : urgentAt, 1);
        lastAt = Date.now();
        turn?.go();
        next();
      },
      Math.max(0, lastAt + intervalMs - Date.now()),
    );
  }

  return {
    wait: (urgent) =>
      new Promise<void>((go) => {
        waiting.push({ urgent, go });
        next();
      }),
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
