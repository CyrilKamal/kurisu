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

/** The list fields a change touches (only the ones that changed are present). */
export const listChangeSchema = z
  .object({
    status: listStatusSchema.optional(),
    episodesWatched: z.number().int().nonnegative().optional(),
    score: z.number().int().min(0).max(10).optional(),
    isRewatching: z.boolean().optional(),
  })
  .strict();
export type ListChange = z.infer<typeof listChangeSchema>;

/** A committed write to MAL, from the change log. */
export const changeViewSchema = z.object({
  id: z.uuid(),
  animeId: z.number().int().positive(),
  title: z.string(),
  before: listChangeSchema,
  after: listChangeSchema,
  committedAt: z.iso.datetime(),
  /** True once someone pressed Undo on it. */
  undone: z.boolean(),
  /** True if this change is itself an undo. */
  isUndo: z.boolean(),
});
export type ChangeView = z.infer<typeof changeViewSchema>;

/** A change the agent staged that waits for the user to confirm it. */
export const pendingProposalViewSchema = z.object({
  id: z.uuid(),
  animeId: z.number().int().positive(),
  title: z.string(),
  before: listChangeSchema,
  change: listChangeSchema,
  reason: z.string().nullable(),
});
export type PendingProposalView = z.infer<typeof pendingProposalViewSchema>;

export const chatMessageViewSchema = z.object({
  id: z.uuid(),
  role: z.enum(["user", "assistant"]),
  content: z.string(),
  createdAt: z.iso.datetime(),
  changes: z.array(changeViewSchema),
  pending: z.array(pendingProposalViewSchema),
});
export type ChatMessageView = z.infer<typeof chatMessageViewSchema>;

/** GET /chat, and POST /chat/messages (the new user and assistant messages). */
export const chatThreadResponseSchema = z.object({ messages: z.array(chatMessageViewSchema) });

/** GET /changes: newest first. */
export const changesResponseSchema = z.object({ changes: z.array(changeViewSchema) });

/** POST /proposals/:id/confirm and POST /changes/:id/undo, on success. */
export const changeResponseSchema = z.object({ change: changeViewSchema });

/** Why a confirm, cancel or undo didn't happen. */
export const WRITE_ERRORS = [
  "not_found",
  "stale",
  "changed_since",
  "already_undone",
  "cancelled",
  "not_cancellable",
  "in_progress",
  "not_on_list",
  "reauth_required",
  "mal_rejected",
  "mal_unavailable",
  "invalid_response",
  "internal_error",
] as const;
export const writeErrorResponseSchema = z.object({ error: z.enum(WRITE_ERRORS) });

/** GET /push/public-key: the VAPID key browsers subscribe with, or null when push is off. */
export const pushPublicKeyResponseSchema = z.object({ publicKey: z.string().nullable() });
export type PushPublicKeyResponse = z.infer<typeof pushPublicKeyResponseSchema>;

/** POST and DELETE /push/subscriptions, on success. */
export const pushSubscriptionResponseSchema = z.object({ subscribed: z.boolean() });

/** POST /push/test, on success: how many of the user's browsers got the test notification. */
export const pushTestResponseSchema = z.object({
  sent: z.number().int().nonnegative(),
  removed: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
});
export type PushTestResponse = z.infer<typeof pushTestResponseSchema>;

/** Why a push request didn't go through. */
export const PUSH_ERRORS = [
  "push_disabled",
  "invalid_subscription",
  "unsupported_push_service",
  "too_soon",
  "no_subscriptions",
] as const;
export type PushError = (typeof PUSH_ERRORS)[number];
export const pushErrorResponseSchema = z.object({ error: z.enum(PUSH_ERRORS) });
