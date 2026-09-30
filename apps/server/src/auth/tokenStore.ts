import { eq } from "drizzle-orm";

import { TokenDecryptionError, type TokenCipher } from "../crypto/tokenCipher.js";
import type { Db, Executor } from "../db/client.js";
import { malTokens } from "../db/schema.js";
import { MalOAuthError, refreshTokens, type MalOAuthConfig, type MalTokens } from "../mal/oauth.js";

/** Refresh this long before MAL's reported expiry, so a request never races the deadline. */
export const REFRESH_MARGIN_MS = 5 * 60 * 1000;

/** The user's MAL grant is gone (revoked, expired or undecryptable); they must log in again. */
export class ReauthRequiredError extends Error {
  constructor() {
    super("MAL authorization expired; the user must log in again");
    this.name = "ReauthRequiredError";
  }
}

export interface TokenStore {
  save(userId: string, tokens: MalTokens, executor?: Executor): Promise<void>;
  /** Returns a usable access token, refreshing it first if it is about to expire. */
  getValidAccessToken(userId: string): Promise<string>;
  /** Forces a refresh, e.g. after MAL rejected an access token with 401. */
  refresh(userId: string): Promise<string>;
}

const accessContext = (userId: string) => `mal_access_token:${userId}`;
const refreshContext = (userId: string) => `mal_refresh_token:${userId}`;

export function createTokenStore(deps: {
  db: Db;
  cipher: TokenCipher;
  oauth: MalOAuthConfig;
}): TokenStore {
  const { db, cipher, oauth } = deps;
  // One in-flight refresh per user: MAL rotates refresh tokens, so two concurrent refreshes
  // would race and the loser would present an already-used token.
  const inflight = new Map<string, Promise<string>>();

  async function save(userId: string, tokens: MalTokens, executor: Executor = db): Promise<void> {
    const values = {
      accessTokenEnc: cipher.encrypt(tokens.accessToken, accessContext(userId)),
      refreshTokenEnc: cipher.encrypt(tokens.refreshToken, refreshContext(userId)),
      accessExpiresAt: new Date(Date.now() + tokens.expiresIn * 1000),
      needsReauth: false,
      updatedAt: new Date(),
    };
    await executor
      .insert(malTokens)
      .values({ userId, ...values })
      .onConflictDoUpdate({ target: malTokens.userId, set: values });
  }

  async function markNeedsReauth(userId: string): Promise<never> {
    await db
      .update(malTokens)
      .set({ needsReauth: true, updatedAt: new Date() })
      .where(eq(malTokens.userId, userId));
    throw new ReauthRequiredError();
  }

  async function loadRow(userId: string) {
    const [row] = await db.select().from(malTokens).where(eq(malTokens.userId, userId)).limit(1);
    if (!row || row.needsReauth) {
      throw new ReauthRequiredError();
    }
    return row;
  }

  async function doRefresh(userId: string): Promise<string> {
    const row = await loadRow(userId);
    let refreshToken: string;
    try {
      refreshToken = cipher.decrypt(row.refreshTokenEnc, refreshContext(userId));
    } catch (err) {
      if (err instanceof TokenDecryptionError) return markNeedsReauth(userId);
      throw err;
    }

    let tokens: MalTokens;
    try {
      tokens = await refreshTokens(oauth, refreshToken);
    } catch (err) {
      if (err instanceof MalOAuthError && err.isGrantRejected) return markNeedsReauth(userId);
      throw err;
    }
    await save(userId, tokens);
    return tokens.accessToken;
  }

  function refresh(userId: string): Promise<string> {
    const existing = inflight.get(userId);
    if (existing) return existing;
    const pending = doRefresh(userId).finally(() => inflight.delete(userId));
    inflight.set(userId, pending);
    return pending;
  }

  async function getValidAccessToken(userId: string): Promise<string> {
    const pending = inflight.get(userId);
    if (pending) return pending;

    const row = await loadRow(userId);
    if (row.accessExpiresAt.getTime() - Date.now() <= REFRESH_MARGIN_MS) {
      return refresh(userId);
    }
    try {
      return cipher.decrypt(row.accessTokenEnc, accessContext(userId));
    } catch (err) {
      if (err instanceof TokenDecryptionError) return markNeedsReauth(userId);
      throw err;
    }
  }

  return { save, getValidAccessToken, refresh };
}
