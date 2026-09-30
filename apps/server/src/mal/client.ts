import { z } from "zod";

// Read-only MAL API calls. Milestone 1 has no write path: nothing here may modify a MAL list.

const meSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1),
});

export interface MalUser {
  id: number;
  name: string;
}

export const MAL_LIST_STATUSES = [
  "watching",
  "completed",
  "on_hold",
  "dropped",
  "plan_to_watch",
] as const;

const animeListItemSchema = z.object({
  node: z.object({
    id: z.number().int().positive(),
    title: z.string(),
    main_picture: z
      .object({ medium: z.string().optional(), large: z.string().optional() })
      .nullish(),
    media_type: z.string().nullish(),
    num_episodes: z.number().int().nonnegative().nullish(),
    status: z.string().nullish(),
    alternative_titles: z
      .object({
        synonyms: z.array(z.string()).nullish(),
        en: z.string().nullish(),
        ja: z.string().nullish(),
      })
      .nullish(),
  }),
  list_status: z.object({
    status: z.enum(MAL_LIST_STATUSES),
    score: z.number().int().min(0).max(10),
    num_episodes_watched: z.number().int().nonnegative(),
    is_rewatching: z.boolean(),
    updated_at: z.iso.datetime({ offset: true }),
    start_date: z.string().nullish(),
    finish_date: z.string().nullish(),
  }),
});

const animeListPageSchema = z.object({
  data: z.array(animeListItemSchema),
  paging: z.object({ next: z.string().optional() }).optional(),
});

export type MalAnimeListItem = z.infer<typeof animeListItemSchema>;

/** A non-2xx response from the MAL API. Never includes the access token or response body. */
export class MalApiError extends Error {
  constructor(
    readonly status: number,
    readonly path: string,
  ) {
    super(`MAL API ${path} returned ${String(status)}`);
    this.name = "MalApiError";
  }
}

/** MAL returned something we can't safely use (bad shape, or a paging link off MAL's host). */
export class MalResponseError extends Error {
  constructor(
    readonly path: string,
    reason: string,
  ) {
    super(`MAL API ${path}: ${reason}`);
    this.name = "MalResponseError";
  }
}

export interface RetryOptions {
  /** Retries after the first attempt, for 429, 5xx and network errors. */
  retries: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

export const DEFAULT_RETRY: RetryOptions = { retries: 3, baseDelayMs: 500, maxDelayMs: 30_000 };

const LIST_FIELDS = "list_status,num_episodes,media_type,status,main_picture,alternative_titles";
const LIST_PAGE_SIZE = 1000; // MAL's maximum for this endpoint

export async function fetchMe(apiBaseUrl: string, accessToken: string): Promise<MalUser> {
  const body = await getJson(new URL(`${apiBaseUrl}/users/@me`), accessToken, {
    ...DEFAULT_RETRY,
    retries: 0,
  });
  return meSchema.parse(body);
}

export function animeListFirstPageUrl(apiBaseUrl: string): URL {
  const url = new URL(`${apiBaseUrl}/users/@me/animelist`);
  url.search = new URLSearchParams({
    fields: LIST_FIELDS,
    limit: String(LIST_PAGE_SIZE),
    // Include NSFW entries, so the mirror matches the user's whole list.
    nsfw: "true",
  }).toString();
  return url;
}

/**
 * Fetches one page of the user's anime list. Returns the items and the next page's URL, which
 * is only followed if it stays on MAL's API origin: we never send the token anywhere else.
 */
export async function fetchAnimeListPage(
  apiBaseUrl: string,
  pageUrl: URL,
  accessToken: string,
  retry: RetryOptions = DEFAULT_RETRY,
): Promise<{ items: MalAnimeListItem[]; next: URL | null }> {
  const body = await getJson(pageUrl, accessToken, retry);
  const parsed = animeListPageSchema.safeParse(body);
  if (!parsed.success) {
    throw new MalResponseError(pageUrl.pathname, "unexpected anime list shape");
  }

  const nextRaw = parsed.data.paging?.next;
  let next: URL | null = null;
  if (nextRaw) {
    next = new URL(nextRaw);
    if (next.origin !== new URL(apiBaseUrl).origin) {
      throw new MalResponseError(pageUrl.pathname, "paging link points off MAL's API host");
    }
  }
  return { items: parsed.data.data, next };
}

async function getJson(url: URL, accessToken: string, retry: RetryOptions): Promise<unknown> {
  const path = url.pathname;
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, {
        headers: { authorization: `Bearer ${accessToken}`, accept: "application/json" },
        signal: AbortSignal.timeout(15_000),
      });
    } catch (err) {
      if (attempt < retry.retries) {
        await sleep(backoffDelay(attempt, retry));
        continue;
      }
      throw err;
    }

    if (res.ok) return res.json();

    const retryable = res.status === 429 || res.status >= 500;
    if (retryable && attempt < retry.retries) {
      await res.body?.cancel();
      await sleep(backoffDelay(attempt, retry, res.headers.get("retry-after")));
      continue;
    }
    await res.body?.cancel();
    throw new MalApiError(res.status, path);
  }
}

/**
 * Exponential backoff with full jitter, capped. A Retry-After header (seconds) from MAL wins,
 * within the same cap.
 */
export function backoffDelay(
  attempt: number,
  retry: RetryOptions,
  retryAfter: string | null = null,
  random: () => number = Math.random,
): number {
  if (retryAfter !== null && /^\d+$/.test(retryAfter.trim())) {
    return Math.min(Number(retryAfter) * 1000, retry.maxDelayMs);
  }
  const ceiling = Math.min(retry.baseDelayMs * 2 ** attempt, retry.maxDelayMs);
  return Math.floor(random() * ceiling);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
