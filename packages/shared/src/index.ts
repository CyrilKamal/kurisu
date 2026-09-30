import { z } from "zod";

/**
 * The HTTP contract between the web app and the server. The web app parses every response
 * with these schemas; the server's integration tests check its responses against them, so the
 * two can't drift apart silently.
 */

/** Name of the httpOnly session cookie the server sets. */
export const SESSION_COOKIE = "kurisu_session";

export const LIST_STATUSES = [
  "watching",
  "completed",
  "on_hold",
  "dropped",
  "plan_to_watch",
] as const;
export const listStatusSchema = z.enum(LIST_STATUSES);
export type ListStatus = z.infer<typeof listStatusSchema>;

/** Why a MAL login failed; the server redirects to `/?login_error=<code>`. */
export const LOGIN_ERRORS = [
  "access_denied",
  "invalid_request",
  "invalid_state",
  "token_exchange_failed",
  "mal_unavailable",
] as const;
export type LoginError = (typeof LOGIN_ERRORS)[number];

/** Why a sync failed, as recorded on the sync run. */
export const SYNC_ERRORS = [
  "reauth_required",
  "mal_unavailable",
  "invalid_response",
  "interrupted",
  "internal_error",
] as const;
export type SyncError = (typeof SYNC_ERRORS)[number];

export const lastSyncSchema = z.object({
  status: z.enum(["running", "succeeded", "failed"]),
  trigger: z.enum(["login", "manual"]),
  startedAt: z.iso.datetime(),
  finishedAt: z.iso.datetime().nullable(),
  entriesCount: z.number().int().nonnegative().nullable(),
  error: z.enum(SYNC_ERRORS).nullable(),
});
export type LastSync = z.infer<typeof lastSyncSchema>;

/** GET /me */
export const meResponseSchema = z.object({
  user: z.object({ malUsername: z.string() }),
  needsReauth: z.boolean(),
  lastSync: lastSyncSchema.nullable(),
});
export type MeResponse = z.infer<typeof meResponseSchema>;

export const listEntrySchema = z.object({
  animeId: z.number().int().positive(),
  title: z.string(),
  pictureUrl: z.url({ protocol: /^https$/ }).nullable(),
  mediaType: z.string().nullable(),
  numEpisodes: z.number().int().positive().nullable(),
  airingStatus: z.string().nullable(),
  status: listStatusSchema,
  score: z.number().int().min(0).max(10),
  episodesWatched: z.number().int().nonnegative(),
  isRewatching: z.boolean(),
  updatedAt: z.iso.datetime(),
});
export type ListEntry = z.infer<typeof listEntrySchema>;

/** GET /list: entries sorted by most recently updated on MAL first. */
export const listResponseSchema = z.object({
  entries: z.array(listEntrySchema),
  lastSync: lastSyncSchema.nullable(),
});
export type ListResponse = z.infer<typeof listResponseSchema>;

/** POST /sync, 200 */
export const syncResponseSchema = z.object({
  lastSync: lastSyncSchema,
});

/** POST /sync, 409 / 429 / 502 */
export const syncErrorResponseSchema = z.object({
  error: z.enum(["cooldown", "reauth_required", "sync_failed"]),
  retryAfterSeconds: z.number().int().positive().optional(),
  lastSync: lastSyncSchema.nullable(),
});
export type SyncErrorResponse = z.infer<typeof syncErrorResponseSchema>;
