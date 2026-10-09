import { and, eq, gt, isNull, lt } from "drizzle-orm";

import type { TokenCipher } from "../crypto/tokenCipher.js";
import type { Db } from "../db/client.js";
import { oauthStates } from "../db/schema.js";
import { codeChallengeFor, createCodeVerifier, createState } from "../mal/pkce.js";

export const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

const verifierContext = (state: string) => `oauth_code_verifier:${state}`;

/**
 * Starts a login: stores an encrypted PKCE verifier under a fresh state value, and the invite
 * the login started from, if any.
 */
export async function createOAuthState(
  db: Db,
  cipher: TokenCipher,
  inviteId: string | null = null,
): Promise<{ state: string; codeChallenge: string }> {
  const state = createState();
  const verifier = createCodeVerifier();
  await db.insert(oauthStates).values({
    state,
    codeVerifierEnc: cipher.encrypt(verifier, verifierContext(state)),
    expiresAt: new Date(Date.now() + OAUTH_STATE_TTL_MS),
    inviteId,
  });
  return { state, codeChallenge: codeChallengeFor(verifier) };
}

/**
 * Marks a state as used and returns its verifier and invite. A single atomic UPDATE, so a
 * replayed or concurrent callback can never consume the same state twice. Returns null if the
 * state is unknown, expired or already used.
 */
export async function consumeOAuthState(
  db: Db,
  cipher: TokenCipher,
  state: string,
): Promise<{ codeVerifier: string; inviteId: string | null } | null> {
  const [row] = await db
    .update(oauthStates)
    .set({ consumedAt: new Date() })
    .where(
      and(
        eq(oauthStates.state, state),
        isNull(oauthStates.consumedAt),
        gt(oauthStates.expiresAt, new Date()),
      ),
    )
    .returning({ codeVerifierEnc: oauthStates.codeVerifierEnc, inviteId: oauthStates.inviteId });
  if (!row) return null;
  return {
    codeVerifier: cipher.decrypt(row.codeVerifierEnc, verifierContext(state)),
    inviteId: row.inviteId,
  };
}

export async function deleteExpiredOAuthStates(db: Db): Promise<void> {
  await db.delete(oauthStates).where(lt(oauthStates.expiresAt, new Date()));
}
