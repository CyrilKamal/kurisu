import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

import type { StreamingLink } from "../anilist/client.js";
import type { BriefItem } from "../brief/build.js";
import type { ListChange, ListState } from "../writes/normalize.js";

const timestamptz = (name: string) => timestamp(name, { withTimezone: true });

/** MAL's five list statuses. */
export const listStatus = pgEnum("list_status", [
  "watching",
  "completed",
  "on_hold",
  "dropped",
  "plan_to_watch",
]);

export const syncTrigger = pgEnum("sync_trigger", ["login", "manual"]);
export const syncStatus = pgEnum("sync_status", ["running", "succeeded", "failed"]);
export const proposalStatus = pgEnum("proposal_status", [
  "pending",
  "committing",
  "committed",
  "failed",
  "cancelled",
]);
export const proposalSource = pgEnum("proposal_source", ["agent", "undo"]);

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  malUserId: integer("mal_user_id").notNull().unique(),
  malUsername: text("mal_username").notNull(),
  createdAt: timestamptz("created_at").notNull().defaultNow(),
  updatedAt: timestamptz("updated_at").notNull().defaultNow(),
});

/** MAL OAuth tokens, encrypted at rest (see crypto/tokenCipher.ts). Never log these columns. */
export const malTokens = pgTable("mal_tokens", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  accessTokenEnc: text("access_token_enc").notNull(),
  refreshTokenEnc: text("refresh_token_enc").notNull(),
  accessExpiresAt: timestamptz("access_expires_at").notNull(),
  // Set when a refresh fails; the user has to log in with MAL again.
  needsReauth: boolean("needs_reauth").notNull().default(false),
  updatedAt: timestamptz("updated_at").notNull().defaultNow(),
});

/** Only a SHA-256 hash of the session cookie is stored, so a DB leak can't hijack sessions. */
export const sessions = pgTable(
  "sessions",
  {
    idHash: text("id_hash").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
    expiresAt: timestamptz("expires_at").notNull(),
  },
  (table) => [index("sessions_user_id_idx").on(table.userId)],
);

/** Pending MAL logins: one row per authorize redirect, consumed exactly once by the callback. */
export const oauthStates = pgTable("oauth_states", {
  state: text("state").primaryKey(),
  codeVerifierEnc: text("code_verifier_enc").notNull(),
  createdAt: timestamptz("created_at").notNull().defaultNow(),
  expiresAt: timestamptz("expires_at").notNull(),
  consumedAt: timestamptz("consumed_at"),
});

/**
 * Anime metadata from MAL, shared by all users. Later milestones add columns through new
 * migrations.
 */
export const anime = pgTable("anime", {
  malId: integer("mal_id").primaryKey(),
  title: text("title").notNull(),
  // MAL's alternative titles, used to match nicknames and translated names.
  titleEn: text("title_en"),
  titleJa: text("title_ja"),
  synonyms: text("synonyms")
    .array()
    .notNull()
    .default(sql`'{}'::text[]`),
  mainPictureUrl: text("main_picture_url"),
  // MAL values like tv, movie, ova. Kept as text so a new MAL value can't break a sync.
  mediaType: text("media_type"),
  // Null when MAL doesn't know yet (it reports 0).
  numEpisodes: integer("num_episodes"),
  // MAL values like currently_airing, finished_airing, not_yet_aired.
  airingStatus: text("airing_status"),
  // When MAL says the show started airing, "2026-03-19" or partial ("2026-03"). Used to check how
  // AniList's parts of a split show line up with this entry (see anilist/client.ts joinParts).
  startDate: text("start_date"),
  // Genres, themes and demographics, e.g. "Slice of Life", "Iyashikei", "Shounen".
  genres: text("genres")
    .array()
    .notNull()
    .default(sql`'{}'::text[]`),
  // Minutes per episode; null when MAL doesn't know.
  episodeMinutes: integer("episode_minutes"),
  // MAL's community score.
  malMean: real("mal_mean"),
  updatedAt: timestamptz("updated_at").notNull().defaultNow(),
});

/** The local mirror of each user's MAL anime list. Reads come from here, never live MAL. */
export const listEntries = pgTable(
  "list_entries",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    animeId: integer("anime_id")
      .notNull()
      .references(() => anime.malId),
    status: listStatus("status").notNull(),
    // 0 means unscored, as on MAL.
    score: integer("score").notNull(),
    numEpisodesWatched: integer("num_episodes_watched").notNull(),
    isRewatching: boolean("is_rewatching").notNull(),
    // MAL allows partial dates (e.g. "2024-03"), so these stay as MAL's strings.
    startDate: text("start_date"),
    finishDate: text("finish_date"),
    malUpdatedAt: timestamptz("mal_updated_at").notNull(),
    syncedAt: timestamptz("synced_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.animeId] })],
);

/**
 * AniList's airing data for a MAL entry, shared by all users and refreshed when it gets old
 * (see anilist/cache.ts). A row with no `anilistId` records that AniList has no match.
 */
export const anilistMedia = pgTable(
  "anilist_media",
  {
    malId: integer("mal_id")
      .primaryKey()
      .references(() => anime.malId, { onDelete: "cascade" }),
    anilistId: integer("anilist_id"),
    // AniList values like RELEASING, FINISHED, NOT_YET_RELEASED. Text, so a new value can't
    // break a refresh.
    status: text("status"),
    episodes: integer("episodes"),
    // The next episode to air and when, if AniList has scheduled one.
    nextEpisode: integer("next_episode"),
    nextAiringAt: timestamptz("next_airing_at"),
    // AniList numbers each part of a split show from 1; add this to get MAL's episode numbers
    // for `anilistId` (see anilist/client.ts joinParts). next_episode and episodes are already
    // in MAL's numbering.
    episodeOffset: integer("episode_offset").notNull().default(0),
    // Enabled official streaming links only.
    streamingLinks: jsonb("streaming_links")
      .$type<StreamingLink[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    fetchedAt: timestamptz("fetched_at").notNull(),
  },
  (table) => [index("anilist_media_anilist_id_idx").on(table.anilistId)],
);

/**
 * A browser's Web Push subscription. The endpoint is a capability URL at the browser's push
 * service, so it's never logged.
 */
export const pushSubscriptions = pgTable(
  "push_subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    endpoint: text("endpoint").notNull().unique(),
    // The browser's public key and auth secret, base64url, used to encrypt each message.
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
    lastSentAt: timestamptz("last_sent_at"),
  },
  (table) => [index("push_subscriptions_user_idx").on(table.userId)],
);

/** Each user's morning brief settings. No row means the brief is off. */
export const briefSettings = pgTable("brief_settings", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  enabled: boolean("enabled").notNull().default(false),
  // The user's local time for the brief, "HH:MM".
  localTime: text("local_time").notNull().default("08:00"),
  // IANA time zone from the user's browser, e.g. "America/New_York".
  timeZone: text("time_zone").notNull().default("UTC"),
  // Streaming service ids (see brief/services.ts) the user subscribes to.
  services: text("services")
    .array()
    .notNull()
    .default(sql`'{}'::text[]`),
  updatedAt: timestamptz("updated_at").notNull().defaultNow(),
});

export const briefKind = pgEnum("brief_kind", ["daily", "test"]);
export const briefStatus = pgEnum("brief_status", [
  // Being built; nothing shown to the user yet.
  "building",
  // The chat message is saved; the push may not have gone out.
  "ready",
  "sent",
  // Nothing new aired, so nothing was sent.
  "empty",
  // The server missed the brief time by too much; the day was skipped.
  "skipped_late",
  "failed",
]);

/**
 * One row per brief: what went into it, how it was written, and whether it went out. A daily
 * brief is unique per user and local date, so a retried job can't send a second one.
 */
export const briefs = pgTable(
  "briefs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: briefKind("kind").notNull(),
    // The user's local date the daily brief is for; null for tests.
    localDate: text("local_date"),
    status: briefStatus("status").notNull(),
    // Episodes that aired after windowStart, up to windowEnd.
    windowStart: timestamptz("window_start"),
    windowEnd: timestamptz("window_end"),
    items: jsonb("items").$type<BriefItem[]>(),
    summary: text("summary"),
    // "model" when the model wrote the summary line, "template" when it fell back.
    summarySource: text("summary_source"),
    model: text("model"),
    promptVersion: text("prompt_version"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    summaryLatencyMs: integer("summary_latency_ms"),
    chatMessageId: uuid("chat_message_id").references((): AnyPgColumn => chatMessages.id, {
      onDelete: "set null",
    }),
    pushSent: integer("push_sent"),
    pushFailed: integer("push_failed"),
    // A short error code, never a raw message.
    error: text("error"),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
    updatedAt: timestamptz("updated_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("briefs_daily_user_date_idx")
      .on(table.userId, table.localDate)
      .where(sql`${table.kind} = 'daily'`),
    index("briefs_user_created_idx").on(table.userId, table.createdAt.desc()),
  ],
);

/**
 * Rating patterns: per user and genre, how they score it and how often they drop it. Recomputed
 * from the mirror after each sync and before each recommendation (see taste/profile.ts).
 */
export const tasteGenres = pgTable(
  "taste_genres",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    genre: text("genre").notNull(),
    // Shows in this genre the user scored, and their average score.
    scored: integer("scored").notNull(),
    meanScore: real("mean_score"),
    dropped: integer("dropped").notNull(),
    // How much better (or worse) than the user's overall average they score this genre, pulled
    // toward 0 when few shows back it.
    affinity: real("affinity").notNull(),
    updatedAt: timestamptz("updated_at").notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.genre] })],
);

/** Why the user dropped a show, in their own words, from the change that dropped it. */
export const dropReasons = pgTable(
  "drop_reasons",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    animeId: integer("anime_id")
      .notNull()
      .references(() => anime.malId),
    // pacing, story, characters, art_animation, too_long, lost_interest or other.
    category: text("category").notNull(),
    // The user's message that gave the reason.
    said: text("said").notNull(),
    changeId: uuid("change_id")
      .unique()
      .references((): AnyPgColumn => changes.id, { onDelete: "set null" }),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
  },
  (table) => [index("drop_reasons_user_idx").on(table.userId, table.createdAt.desc())],
);

/** One row per sync attempt, for the "last synced" display, cooldowns and debugging. */
export const syncRuns = pgTable(
  "sync_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    trigger: syncTrigger("trigger").notNull(),
    status: syncStatus("status").notNull(),
    startedAt: timestamptz("started_at").notNull().defaultNow(),
    finishedAt: timestamptz("finished_at"),
    entriesCount: integer("entries_count"),
    // A short error code (see sync/listSync.ts), never a raw message.
    error: text("error"),
  },
  (table) => [index("sync_runs_user_started_idx").on(table.userId, table.startedAt.desc())],
);

/**
 * A staged change to one list entry. Only commitProposal() turns a proposal into a MAL write.
 * Values are absolute (never "+2"), so committing the same proposal twice cannot double-count.
 */
export const proposals = pgTable(
  "proposals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    animeId: integer("anime_id")
      .notNull()
      .references(() => anime.malId),
    source: proposalSource("source").notNull(),
    // The agent run that proposed it; null for undo proposals.
    runId: uuid("run_id").references((): AnyPgColumn => agentRuns.id),
    // Proposing the same change twice (e.g. a repeated tool call) returns the same proposal.
    idempotencyKey: text("idempotency_key").notNull(),
    // The entry's four list fields when proposed. Commit refuses if the mirror has moved since.
    before: jsonb("before").$type<ListState>().notNull(),
    // Only the fields that change, with their new values.
    change: jsonb("change").$type<ListChange>().notNull(),
    requiresConfirmation: boolean("requires_confirmation").notNull().default(false),
    // Why the user dropped the show, when they said: a category (see taste/dropReasons.ts) and
    // their own message. Saved to drop_reasons when the drop commits.
    dropReason: text("drop_reason"),
    dropSaid: text("drop_said"),
    // Why confirmation is needed: ambiguous_match, progress_backwards, not_yet_aired,
    // newest_episode_unknown, score_not_given or not_in_brief.
    confirmationReason: text("confirmation_reason"),
    status: proposalStatus("status").notNull().default("pending"),
    // A short error code when a commit failed.
    error: text("error"),
    undoOfChangeId: uuid("undo_of_change_id").references((): AnyPgColumn => changes.id),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
    updatedAt: timestamptz("updated_at").notNull().defaultNow(),
    committedAt: timestamptz("committed_at"),
  },
  (table) => [
    uniqueIndex("proposals_user_idempotency_key_idx").on(table.userId, table.idempotencyKey),
    index("proposals_user_created_idx").on(table.userId, table.createdAt.desc()),
  ],
);

/** The change log: every committed write, with prior values so it can be undone. */
export const changes = pgTable(
  "changes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    animeId: integer("anime_id")
      .notNull()
      .references(() => anime.malId),
    proposalId: uuid("proposal_id")
      .notNull()
      .unique()
      .references((): AnyPgColumn => proposals.id),
    // Prior values of exactly the fields that changed.
    before: jsonb("before").$type<ListChange>().notNull(),
    // New values of those fields, as MAL confirmed them.
    after: jsonb("after").$type<ListChange>().notNull(),
    committedAt: timestamptz("committed_at").notNull().defaultNow(),
    // Set when this change was undone, pointing at the change that undid it.
    undoneByChangeId: uuid("undone_by_change_id").references((): AnyPgColumn => changes.id),
  },
  (table) => [index("changes_user_committed_idx").on(table.userId, table.committedAt.desc())],
);

export const chatRole = pgEnum("chat_role", ["user", "assistant"]);
export const agentOutcome = pgEnum("agent_outcome", [
  "committed",
  "needs_confirmation",
  "clarification",
  "no_action",
  "error",
]);
export const agentStepKind = pgEnum("agent_step_kind", ["model_call", "tool_call"]);

/** A chat thread. The Chat screen shows the user's latest one. */
export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
  },
  (table) => [index("conversations_user_created_idx").on(table.userId, table.createdAt.desc())],
);

export const chatMessages = pgTable(
  "chat_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    role: chatRole("role").notNull(),
    content: text("content").notNull(),
    // The agent run that produced an assistant message.
    runId: uuid("run_id").references((): AnyPgColumn => agentRuns.id),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
  },
  (table) => [index("chat_messages_conversation_idx").on(table.conversationId, table.createdAt)],
);

/**
 * One agent run: a user message handled by one model (a second run if it escalated).
 * CLAUDE.md: log prompt version, model, tool calls with arguments, latency, tokens and outcome.
 */
export const agentRuns = pgTable(
  "agent_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id").references(() => conversations.id, {
      onDelete: "set null",
    }),
    // Set on an escalated run: the run it retried.
    escalatedFromRunId: uuid("escalated_from_run_id").references((): AnyPgColumn => agentRuns.id),
    promptVersion: text("prompt_version").notNull(),
    model: text("model").notNull(),
    startedAt: timestamptz("started_at").notNull().defaultNow(),
    finishedAt: timestamptz("finished_at"),
    latencyMs: integer("latency_ms"),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    outcome: agentOutcome("outcome"),
    // A short error code when the run failed.
    error: text("error"),
  },
  (table) => [index("agent_runs_user_started_idx").on(table.userId, table.startedAt.desc())],
);

/** Every model call and tool call within a run, in order, with arguments and results. */
export const agentRunSteps = pgTable(
  "agent_run_steps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id")
      .notNull()
      .references(() => agentRuns.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    kind: agentStepKind("kind").notNull(),
    toolName: text("tool_name"),
    args: jsonb("args"),
    // Truncated; enough to debug a run without storing whole lists.
    result: jsonb("result"),
    latencyMs: integer("latency_ms").notNull(),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    error: text("error"),
  },
  (table) => [uniqueIndex("agent_run_steps_run_seq_idx").on(table.runId, table.seq)],
);
