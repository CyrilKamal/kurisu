import { and, eq, gt, isNull, lt } from "drizzle-orm";

import type { TokenCipher } from "../crypto/tokenCipher.js";
import type { Db } from "../db/client.js";
import { oauthStates } from "../db/schema.js";
import { codeChallengeFor, createCodeVerifier, createState } from "../mal/pkce.js";

export const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

const verifierContext = (state: string) => `oauth_code_verifier:${state}`;

/** Starts a login: stores an encrypted PKCE verifier under a fresh state value. */
export async function createOAuthState(
  db: Db,
  cipher: TokenCipher,
): Promise<{ state: string; codeChallenge: string }> {
  const state = createState();
  const verifier = createCodeVerifier();
  await db.insert(oauthStates).values({
    state,
    codeVerifierEnc: cipher.encrypt(verifier, verifierContext(state)),
    expiresAt: new Date(Date.now() + OAUTH_STATE_TTL_MS),
  });
  return { state, codeChallenge: codeChallengeFor(verifier) };
}

/**
 * Marks a state as used and returns its verifier. A single atomic UPDATE, so a replayed or
 * concurrent callback can never consume the same state twice. Returns null if the state is
 * unknown, expired or already used.
 */
export async function consumeOAuthState(
  db: Db,
  cipher: TokenCipher,
  state: string,
): Promise<string | null> {
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
    .returning({ codeVerifierEnc: oauthStates.codeVerifierEnc });
  return row ? cipher.decrypt(row.codeVerifierEnc, verifierContext(state)) : null;
}

export async function deleteExpiredOAuthStates(db: Db): Promise<void> {
  await db.delete(oauthStates).where(lt(oauthStates.expiresAt, new Date()));
}
