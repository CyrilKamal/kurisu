import { sql } from "drizzle-orm";
import {
  boolean,
  check,
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

import type { SequelShow, StreamingLink } from "../anilist/client.js";
import type { BriefAlert, BriefItem } from "../brief/build.js";
import type { BriefRecap } from "../brief/recap.js";
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
// Who staged a proposal: the agent, an undo, the user on the List screen, or an import.
export const proposalSource = pgEnum("proposal_source", ["agent", "undo", "user", "import"]);
/**
 * update: changes an entry on the list. add: puts a show on the list (always confirmed by the
 * user first). remove: takes one off, only to undo an add.
 */
export const writeKind = pgEnum("write_kind", ["update", "add", "remove"]);

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  malUserId: integer("mal_user_id").notNull().unique(),
  malUsername: text("mal_username").notNull(),
  // The MAL account named by OWNER_MAL_USERNAME, set at each login. Only the owner invites.
  isOwner: boolean("is_owner").notNull().default(false),
  // Whether friends see what this user watches (episodes, finishes, scores, drops). Off, they
  // see only the taste match.
  shareActivity: boolean("share_activity").notNull().default(true),
  // When they finished or skipped the welcome steps; null sends a new account through them.
  welcomedAt: timestamptz("welcomed_at"),
  createdAt: timestamptz("created_at").notNull().defaultNow(),
  updatedAt: timestamptz("updated_at").notNull().defaultNow(),
});

/**
 * One-time links the owner shares. While sign-up is closed, a new account needs one. Only a
 * SHA-256 hash of the code in the link is stored, like sessions.
 */
export const invites = pgTable(
  "invites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    codeHash: text("code_hash").notNull().unique(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // Who it's for, so the owner can tell links apart. Never shown to the person invited.
    note: text("note"),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
    expiresAt: timestamptz("expires_at").notNull(),
    usedBy: uuid("used_by").references(() => users.id, { onDelete: "set null" }),
    usedAt: timestamptz("used_at"),
  },
  (table) => [index("invites_created_by_idx").on(table.createdBy)],
);

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

/**
 * Two users who are friends, stored once with the smaller id first. Made by joining with an
 * invite (the inviter and the new user) or by opening someone's friend link.
 */
export const friendships = pgTable(
  "friendships",
  {
    userA: uuid("user_a")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    userB: uuid("user_b")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    via: text("via", { enum: ["invite", "link"] }).notNull(),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.userA, table.userB] }),
    index("friendships_user_b_idx").on(table.userB),
    check("friendships_ordered", sql`${table.userA} < ${table.userB}`),
  ],
);

/**
 * Each user's friend link, which any logged-in user can open to become their friend. The code is
 * kept encrypted, so the link can be copied again, and hashed, so it can be looked up.
 */
export const friendLinks = pgTable("friend_links", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  codeHash: text("code_hash").notNull().unique(),
  codeEnc: text("code_enc").notNull(),
  createdAt: timestamptz("created_at").notNull().defaultNow(),
});

/** Pending MAL logins: one row per authorize redirect, consumed exactly once by the callback. */
export const oauthStates = pgTable("oauth_states", {
  state: text("state").primaryKey(),
  codeVerifierEnc: text("code_verifier_enc").notNull(),
  createdAt: timestamptz("created_at").notNull().defaultNow(),
  expiresAt: timestamptz("expires_at").notNull(),
  consumedAt: timestamptz("consumed_at"),
  // The invite this login started from, if any; it's used up only when the account is created.
  inviteId: uuid("invite_id").references(() => invites.id, { onDelete: "set null" }),
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
  // AniList's description as plain text, fetched the first time someone opens the show's page.
  // Null until then; "" when AniList has none. Syncs never touch it.
  synopsis: text("synopsis"),
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
 * The anime that follow each show (AniList's SEQUEL relations), keyed by the earlier show's MAL
 * id. Shared by all users; refetched weekly for the shows a user completed (anilist/sequels.ts),
 * so the brief can say when one starts airing.
 */
export const anilistSequels = pgTable("anilist_sequels", {
  malId: integer("mal_id")
    .primaryKey()
    .references(() => anime.malId, { onDelete: "cascade" }),
  sequels: jsonb("sequels")
    .$type<SequelShow[]>()
    .notNull()
    .default(sql`'[]'::jsonb`),
  fetchedAt: timestamptz("fetched_at").notNull(),
});

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
  // On Sundays the brief also sums up the user's week (brief/recap.ts).
  sundayRecap: boolean("sunday_recap").notNull().default(true),
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
    // Shows that started airing in the window: a sequel to one they finished, or one on their
    // Plan to Watch.
    alerts: jsonb("alerts")
      .$type<BriefAlert[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    // A Sunday brief's sum of the week, when it had one.
    recap: jsonb("recap").$type<BriefRecap>(),
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

/**
 * The user's reactions to shows, in their own words, saved with the change they came with
 * ("finished frieren, that finale was insane"). Each can be deleted; undoing the change takes
 * its note back.
 */
export const diaryNotes = pgTable(
  "diary_notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    animeId: integer("anime_id")
      .notNull()
      .references(() => anime.malId),
    changeId: uuid("change_id")
      .unique()
      .references((): AnyPgColumn => changes.id, { onDelete: "set null" }),
    text: text("text").notNull(),
    // Shown to friends with the update, like a review. Notes are saved from chat on their own,
    // so each stays private until its owner shares it.
    shared: boolean("shared").notNull().default(false),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
  },
  (table) => [index("diary_notes_user_idx").on(table.userId, table.createdAt.desc())],
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
    kind: writeKind("kind").notNull().default("update"),
    // The agent run that proposed it; null for undo proposals.
    runId: uuid("run_id").references((): AnyPgColumn => agentRuns.id),
    // Proposing the same change twice (e.g. a repeated tool call) returns the same proposal.
    idempotencyKey: text("idempotency_key").notNull(),
    // The entry's four list fields when proposed. Commit refuses if the mirror has moved since.
    // Null for an add: the show wasn't on the list.
    before: jsonb("before").$type<ListState>(),
    // Only the fields that change, with their new values.
    change: jsonb("change").$type<ListChange>().notNull(),
    requiresConfirmation: boolean("requires_confirmation").notNull().default(false),
    // Why the user dropped the show, when they said: a category (see taste/dropReasons.ts) and
    // their own message. Saved to drop_reasons when the drop commits.
    dropReason: text("drop_reason"),
    dropSaid: text("drop_said"),
    // Why confirmation is needed: ambiguous_match, progress_backwards, not_yet_aired,
    // newest_episode_unknown, score_not_given, not_in_brief, not_named, or adds_to_list (every add).
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
    kind: writeKind("kind").notNull().default("update"),
    // Prior values of exactly the fields that changed; empty for an add.
    before: jsonb("before").$type<ListChange>().notNull(),
    // New values of those fields, as MAL confirmed them; empty for a remove.
    after: jsonb("after").$type<ListChange>().notNull(),
    committedAt: timestamptz("committed_at").notNull().defaultNow(),
    // Set when this change was undone, pointing at the change that undid it.
    undoneByChangeId: uuid("undone_by_change_id").references((): AnyPgColumn => changes.id),
  },
  (table) => [index("changes_user_committed_idx").on(table.userId, table.committedAt.desc())],
);

export const listEventKind = pgEnum("list_event_kind", ["added", "updated", "removed"]);

/**
 * Changes made to the list outside kurisu (on MAL's site or another app), found by a sync that
 * compares MAL's list with the mirror (stats/events.ts). kurisu's own writes are in `changes`,
 * and they leave nothing for a sync to find, since a commit writes MAL's answer into the mirror.
 */
export const listEvents = pgTable(
  "list_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    animeId: integer("anime_id")
      .notNull()
      .references(() => anime.malId),
    kind: listEventKind("kind").notNull(),
    // Prior values of exactly the fields that changed; empty when it was added.
    before: jsonb("before").$type<ListChange>().notNull(),
    // New values of those fields; empty when it was removed.
    after: jsonb("after").$type<ListChange>().notNull(),
    // When MAL says the entry changed; for a removal, when the sync noticed.
    at: timestamptz("at").notNull(),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
  },
  (table) => [index("list_events_user_at_idx").on(table.userId, table.at.desc())],
);

/** A user's goal for a year: how many shows to complete in it. */
export const yearlyGoals = pgTable(
  "yearly_goals",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    year: integer("year").notNull(),
    target: integer("target").notNull(),
    updatedAt: timestamptz("updated_at").notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.year] })],
);

export const chatRole = pgEnum("chat_role", ["user", "assistant"]);
export const agentOutcome = pgEnum("agent_outcome", [
  "committed",
  "needs_confirmation",
  "clarification",
  "no_action",
  "error",
  // The recommendation agent presented picks.
  "recommended",
]);
export const agentStepKind = pgEnum("agent_step_kind", ["model_call", "tool_call"]);

/** A chat thread. Chat lists them by latest message and opens the most recent one. */
export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // From the first message, or the brief's date. Older chats have none and show their first
    // message instead.
    title: text("title"),
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
    // Shows an assistant message names, in order, shown as cards (see chat/mentions.ts).
    showIds: integer("show_ids")
      .array()
      .notNull()
      .default(sql`'{}'::integer[]`),
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
    // Set on a recommendation run: the progress-sync run that handed the message over.
    handedOffFromRunId: uuid("handed_off_from_run_id").references((): AnyPgColumn => agentRuns.id),
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

/** One recommendation: the picks the recommendation agent presented, with their reasons. */
export const recommendations = pgTable(
  "recommendations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    runId: uuid("run_id")
      .notNull()
      .unique()
      .references((): AnyPgColumn => agentRuns.id, { onDelete: "cascade" }),
    // The chat message the picks show under; set once the reply is saved.
    chatMessageId: uuid("chat_message_id").references((): AnyPgColumn => chatMessages.id, {
      onDelete: "set null",
    }),
    picks: jsonb("picks").$type<{ animeId: number; why: string }[]>().notNull(),
    // The constraints of the search each pick came from, for debugging and the eval.
    constraints: jsonb("constraints").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("recommendations_user_idx").on(table.userId, table.createdAt.desc()),
    index("recommendations_message_idx").on(table.chatMessageId),
  ],
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

/**
 * Shows from AniList's catalog that recommendations can reach beyond the user's list, in MAL's
 * words. Shared by all users; written by each user's discovery refresh (recommend/discovery.ts).
 */
export const anilistCatalog = pgTable("anilist_catalog", {
  malId: integer("mal_id").primaryKey(),
  anilistId: integer("anilist_id").notNull(),
  title: text("title").notNull(),
  titleEn: text("title_en"),
  titleJa: text("title_ja"),
  synonyms: text("synonyms")
    .array()
    .notNull()
    .default(sql`'{}'::text[]`),
  // MAL's words: tv, movie, ova...; finished_airing, currently_airing.
  mediaType: text("media_type"),
  airingStatus: text("airing_status"),
  numEpisodes: integer("num_episodes"),
  episodeMinutes: integer("episode_minutes"),
  // MAL's genre, theme and demographic names, from AniList's genres and main tags.
  genres: text("genres")
    .array()
    .notNull()
    .default(sql`'{}'::text[]`),
  // AniList's average score, on MAL's 10-point scale.
  score: real("score"),
  popularity: integer("popularity"),
  coverUrl: text("cover_url"),
  startDate: text("start_date"),
  // The entries this one follows (AniList PREQUEL relations), by MAL id.
  prequelMalIds: integer("prequel_mal_ids")
    .array()
    .notNull()
    .default(sql`'{}'::integer[]`),
  // Enabled official streaming links only, as in anilist_media.
  streamingLinks: jsonb("streaming_links")
    .$type<StreamingLink[]>()
    .notNull()
    .default(sql`'[]'::jsonb`),
  fetchedAt: timestamptz("fetched_at").notNull().defaultNow(),
});

/** Each user's pool of shows new to them, found on AniList from their taste. */
export const discovery = pgTable(
  "discovery",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    malId: integer("mal_id").notNull(),
    // How strongly AniList points at it for this user, summed over where it was found.
    strength: real("strength").notNull(),
    // Titles of the user's favorites whose fans like it, strongest first.
    because: text("because")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
  },
  (table) => [primaryKey({ columns: [table.userId, table.malId] })],
);

/**
 * What's airing now: this season's series and last season's still airing, most popular first,
 * from AniList. Shared by all users (details in anilist_catalog); rebuilt at most daily
 * (recommend/season.ts).
 */
export const seasonShows = pgTable("season_shows", {
  malId: integer("mal_id").primaryKey(),
  anilistId: integer("anilist_id").notNull(),
  // "2026 FALL": the season this lineup is for.
  season: text("season").notNull(),
  // 1 for the most popular.
  rank: integer("rank").notNull(),
  fetchedAt: timestamptz("fetched_at").notNull(),
});

/** When each user's discovery pool was last built, so it's rebuilt at most daily. */
export const discoveryRuns = pgTable("discovery_runs", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  refreshedAt: timestamptz("refreshed_at").notNull(),
  shows: integer("shows").notNull(),
  // A short error code when the last attempt failed; the earlier pool stays.
  error: text("error"),
});

export const importStatus = pgEnum("import_status", [
  "parsing",
  "review",
  "running",
  "done",
  "undoing",
  "undone",
  "failed",
]);
// How a line of notes compares with the list: what the review screen groups it under.
export const importGroup = pgEnum("import_group", [
  "add",
  "update",
  "up_to_date",
  "disagree",
  "which_one",
  "not_found",
  "not_a_show",
]);
export const importItemStatus = pgEnum("import_item_status", [
  "pending",
  "committed",
  "failed",
  "skipped",
  "undone",
  "undo_failed",
]);

/**
 * A list pasted from the user's notes: read by the model, matched and grouped in code, reviewed
 * by the user, then written in the background through the single write path.
 */
export const imports = pgTable(
  "imports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // The notes as pasted.
    text: text("text").notNull(),
    status: importStatus("status").notNull().default("parsing"),
    // A short error code when parsing or a run failed as a whole.
    error: text("error"),
    // The agent run that read the notes, for the logs.
    runId: uuid("run_id").references((): AnyPgColumn => agentRuns.id),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
    updatedAt: timestamptz("updated_at").notNull().defaultNow(),
  },
  (table) => [index("imports_user_created_idx").on(table.userId, table.createdAt.desc())],
);

/** One show mentioned in the notes, and what the import will do with it. */
export const importItems = pgTable(
  "import_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    importId: uuid("import_id")
      .notNull()
      .references(() => imports.id, { onDelete: "cascade" }),
    // Order in the notes: the line, then the show's place on it.
    lineNo: integer("line_no").notNull(),
    position: integer("position").notNull(),
    // The whole line, and the user's own words about this show in it.
    line: text("line").notNull(),
    said: text("said").notNull(),
    // The show's name exactly as written.
    title: text("title").notNull(),
    // What the notes say about it, as read (before matching).
    notes: jsonb("notes").$type<ListChange>().notNull(),
    group: importGroup("group").notNull(),
    // For "which one?": the shows it could be, best first.
    candidates: integer("candidates")
      .array()
      .notNull()
      .default(sql`'{}'::integer[]`),
    animeId: integer("anime_id"),
    // The list entry when grouped, so a run can tell if it changed since the review.
    malState: jsonb("mal_state").$type<ListState>(),
    // What will be written: the normalized change, or for a disagreement the notes' version.
    change: jsonb("change").$type<ListChange>(),
    // A short reason shown with the row, e.g. "ep 40 is past the end (28)".
    note: text("note"),
    checked: boolean("checked").notNull().default(false),
    // For a disagreement: keep_mal (the default) or use_notes.
    resolution: text("resolution"),
    proposalId: uuid("proposal_id").references((): AnyPgColumn => proposals.id),
    status: importItemStatus("status").notNull().default("pending"),
    error: text("error"),
  },
  (table) => [index("import_items_import_idx").on(table.importId, table.lineNo, table.position)],
);

/** Why a reply went to the review queue: it failed, its write was undone soon after, or the user reported it. */
export const reviewKind = pgEnum("review_kind", ["error", "undone", "report"]);
export const reviewStatus = pgEnum("review_status", ["new", "exported", "dismissed"]);

/**
 * Replies that may have gone wrong, for the owner to label as eval cases (pnpm review). Each
 * holds what's needed to replay it: the message, the turns before it, the reply, and the list
 * as it was before the run (eval snapshot entries) with the airing data of its shows then. One
 * per run and kind. It stays private: exports go to the gitignored eval/private/.
 */
export const reviewItems = pgTable(
  "review_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    runId: uuid("run_id")
      .notNull()
      .references(() => agentRuns.id, { onDelete: "cascade" }),
    kind: reviewKind("kind").notNull(),
    // The user's words when they reported it; why it was queued otherwise.
    note: text("note"),
    message: text("message").notNull(),
    history: jsonb("history").$type<{ role: "user" | "assistant"; content: string }[]>().notNull(),
    reply: text("reply").notNull(),
    listSnapshot: jsonb("list_snapshot").$type<unknown[]>().notNull(),
    airing: jsonb("airing").$type<unknown[]>().notNull(),
    status: reviewStatus("status").notNull().default("new"),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("review_items_run_kind_idx").on(table.runId, table.kind),
    index("review_items_status_idx").on(table.status, table.createdAt.desc()),
  ],
);
