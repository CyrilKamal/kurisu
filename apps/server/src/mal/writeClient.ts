import { z } from "zod";

import type { ListChange } from "../writes/normalize.js";
import { DEFAULT_RETRY, malRequestJson, MAL_LIST_STATUSES, type RetryOptions } from "./client.js";

/**
 * The only code that writes to a MAL list. CLAUDE.md: nothing writes to MAL except
 * commit_update, so only src/writes/commit.ts may import this module (enforced by lint and an
 * architecture test).
 */

const listStatusResponseSchema = z.object({
  status: z.enum(MAL_LIST_STATUSES),
  score: z.number().int().min(0).max(10),
  // MAL's quirk: the request field is num_watched_episodes, the response calls it this.
  num_episodes_watched: z.number().int().nonnegative(),
  is_rewatching: z.boolean(),
  updated_at: z.iso.datetime({ offset: true }),
});

/** The list entry as MAL reports it after a write. */
export interface MalListStatus {
  status: (typeof MAL_LIST_STATUSES)[number];
  score: number;
  episodesWatched: number;
  isRewatching: boolean;
  updatedAt: Date;
}

/**
 * PATCH /anime/{id}/my_list_status with absolute values only, so a retry (ours or the
 * helper's on 5xx/429) can never double-count.
 */
export async function patchListStatus(
  apiBaseUrl: string,
  accessToken: string,
  animeId: number,
  change: ListChange,
  retry: RetryOptions = DEFAULT_RETRY,
): Promise<MalListStatus> {
  const form = new URLSearchParams();
  if (change.status !== undefined) form.set("status", change.status);
  if (change.episodesWatched !== undefined) {
    form.set("num_watched_episodes", String(change.episodesWatched));
  }
  if (change.score !== undefined) form.set("score", String(change.score));
  if (change.isRewatching !== undefined) form.set("is_rewatching", String(change.isRewatching));

  const body = await malRequestJson(
    new URL(`${apiBaseUrl}/anime/${String(animeId)}/my_list_status`),
    accessToken,
    retry,
    { method: "PATCH", form },
  );
  const parsed = listStatusResponseSchema.parse(body);
  return {
    status: parsed.status,
    score: parsed.score,
    episodesWatched: parsed.num_episodes_watched,
    isRewatching: parsed.is_rewatching,
    updatedAt: new Date(parsed.updated_at),
  };
}
