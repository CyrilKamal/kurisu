import { randomBytes } from "node:crypto";

/**
 * MAL only supports the `plain` PKCE method (no S256), so the code challenge is the verifier
 * itself. The verifier still has to stay secret until the token exchange: it is stored
 * encrypted server-side and never sent to the browser.
 */
export const CODE_CHALLENGE_METHOD = "plain";

/**
 * 48 random bytes, base64url-encoded: 64 characters from the RFC 7636 unreserved set,
 * inside MAL's 43–128 length limit.
 */
export function createCodeVerifier(): string {
  return randomBytes(48).toString("base64url");
}

export function codeChallengeFor(verifier: string): string {
  return verifier;
}

export function createState(): string {
  return randomBytes(32).toString("base64url");
}
