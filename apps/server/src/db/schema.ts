import { boolean, index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

const timestamptz = (name: string) => timestamp(name, { withTimezone: true });

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
