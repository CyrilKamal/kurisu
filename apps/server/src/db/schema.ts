import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

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
