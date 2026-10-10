import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { OAUTH_STATE_COOKIE } from "../../src/auth/routes.js";
import { SESSION_COOKIE } from "../../src/auth/sessions.js";
import { ReauthRequiredError } from "../../src/auth/tokenStore.js";
import { malTokens, oauthStates, sessions, users } from "../../src/db/schema.js";
import { TEST_MAL_CLIENT, TEST_WEB_ORIGIN } from "../support/testConfig.js";
import {
  login,
  resetDatabase,
  startHarness,
  TEST_MAL_USER,
  type Harness,
} from "../support/harness.js";

let h: Harness;
/** Session cookie values seen during the run; like MAL secrets, they must never be logged. */
const sessionCookies: string[] = [];

beforeAll(async () => {
  h = await startHarness();
});

afterAll(async () => {
  await h.close();
});

beforeEach(async () => {
  await resetDatabase(h.db);
  h.fakeMal.reset();
});

async function loginOk() {
  const result = await login(h);
  expect(result.callbackResponse.statusCode).toBe(302);
  expect(result.callbackResponse.headers.location).toBe("/today");
  if (!result.sessionCookie) throw new Error("expected a session cookie");
  sessionCookies.push(result.sessionCookie);
  return result.sessionCookie;
}

async function userId(): Promise<string> {
  const [user] = await h.db.select().from(users).where(eq(users.malUserId, TEST_MAL_USER.id));
  if (!user) throw new Error("user not found");
  return user.id;
}

describe("GET /auth/mal/login", () => {
  it("redirects to MAL's authorize endpoint with plain PKCE", async () => {
    const res = await h.app.inject({ method: "GET", url: "/auth/mal/login" });

    expect(res.statusCode).toBe(302);
    const location = new URL(String(res.headers.location));
    expect(`${location.origin}${location.pathname}`).toBe(`${h.fakeMal.authBaseUrl}/authorize`);

    const params = location.searchParams;
    expect(params.get("response_type")).toBe("code");
    expect(params.get("client_id")).toBe(TEST_MAL_CLIENT.clientId);
    expect(params.get("code_challenge_method")).toBe("plain");
    expect(params.get("redirect_uri")).toBe(TEST_MAL_CLIENT.redirectUri);
    const challenge = params.get("code_challenge") ?? "";
    expect(challenge).toMatch(/^[A-Za-z0-9\-._~]{43,128}$/);

    const state = params.get("state") ?? "";
    const cookie = res.cookies.find((c) => c.name === OAUTH_STATE_COOKIE);
    expect(cookie).toMatchObject({ value: state, httpOnly: true, sameSite: "Lax", path: "/" });

    // The verifier is stored encrypted, never in the clear.
    const [row] = await h.db.select().from(oauthStates).where(eq(oauthStates.state, state));
    expect(row?.codeVerifierEnc).toBeDefined();
    expect(row?.codeVerifierEnc).not.toContain(challenge);
    expect(row?.consumedAt).toBeNull();
  });
});

describe("GET /auth/mal/callback", () => {
  it("completes the login: tokens stored encrypted, session cookie issued", async () => {
    const result = await login(h);

    // MAL redirected to the registered URI on the web origin, which Next proxies to us.
    expect(result.callbackUrl.origin + result.callbackUrl.pathname).toBe(
      TEST_MAL_CLIENT.redirectUri,
    );
    expect(result.callbackResponse.statusCode).toBe(302);
    expect(result.callbackResponse.headers.location).toBe("/today");
    expect(h.fakeMal.tokenGrants).toEqual(["authorization_code"]);

    const session = result.callbackResponse.cookies.find((c) => c.name === SESSION_COOKIE);
    expect(session).toMatchObject({ httpOnly: true, sameSite: "Lax", path: "/" });
    expect(session?.secure).toBeFalsy(); // Secure is production-only (dev runs on http)
    const stateCleared = result.callbackResponse.cookies.find((c) => c.name === OAUTH_STATE_COOKIE);
    expect(stateCleared?.value).toBe("");
    sessionCookies.push(session?.value ?? "");

    const id = await userId();
    const [user] = await h.db.select().from(users).where(eq(users.id, id));
    expect(user?.malUsername).toBe(TEST_MAL_USER.name);

    // Tokens are ciphertext at rest and decrypt to what MAL issued.
    const [tokens] = await h.db.select().from(malTokens).where(eq(malTokens.userId, id));
    if (!tokens) throw new Error("tokens not stored");
    const [issuedAccess, issuedRefresh] = h.fakeMal.issuedSecrets.slice(-2);
    expect(tokens.accessTokenEnc).not.toContain(issuedAccess);
    expect(tokens.refreshTokenEnc).not.toContain(issuedRefresh);
    expect(h.cipher.decrypt(tokens.accessTokenEnc, `mal_access_token:${id}`)).toBe(issuedAccess);
    expect(h.cipher.decrypt(tokens.refreshTokenEnc, `mal_refresh_token:${id}`)).toBe(issuedRefresh);
    expect(tokens.needsReauth).toBe(false);

    // Only the session hash is stored.
    const stored = await h.db.select().from(sessions).where(eq(sessions.userId, id));
    expect(stored).toHaveLength(1);
    expect(stored[0]?.idHash).not.toBe(session?.value);

    const me = await h.app.inject({
      method: "GET",
      url: "/me",
      cookies: { [SESSION_COOKIE]: session?.value ?? "" },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({
      user: { malUsername: TEST_MAL_USER.name },
      needsReauth: false,
      lastSync: { trigger: "login", status: "succeeded" },
    });
  });

  it("logging in again updates the same user instead of creating another", async () => {
    await loginOk();
    await loginOk();

    const rows = await h.db.select().from(users);
    expect(rows).toHaveLength(1);
  });

  it("rejects a state that doesn't match the browser's state cookie", async () => {
    const result = await login(h, (req) => {
      req.stateCookie = "someone-elses-state";
    });

    expect(result.callbackResponse.headers.location).toBe("/?login_error=invalid_state");
    expect(result.sessionCookie).toBeUndefined();
    expect(h.fakeMal.tokenGrants).toEqual([]);
  });

  it("rejects a callback without the state cookie", async () => {
    const result = await login(h, (req) => {
      req.stateCookie = undefined;
    });

    expect(result.callbackResponse.headers.location).toBe("/?login_error=invalid_state");
    expect(result.sessionCookie).toBeUndefined();
  });

  it("rejects a replayed callback (state is single-use)", async () => {
    const first = await login(h);
    expect(first.callbackResponse.headers.location).toBe("/today");

    const replay = await h.app.inject({
      method: "GET",
      url: `/auth/mal/callback${first.callbackUrl.search}`,
      cookies: { [OAUTH_STATE_COOKIE]: first.stateCookie },
    });

    expect(replay.headers.location).toBe("/?login_error=invalid_state");
    expect(replay.cookies.find((c) => c.name === SESSION_COOKIE)).toBeUndefined();
    expect(h.fakeMal.tokenGrants).toEqual(["authorization_code"]);
  });

  it("rejects an expired state", async () => {
    const result = await login(h, async (req) => {
      await h.db
        .update(oauthStates)
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where(eq(oauthStates.state, req.query.get("state") ?? ""));
    });

    expect(result.callbackResponse.headers.location).toBe("/?login_error=invalid_state");
    expect(h.fakeMal.tokenGrants).toEqual([]);
  });

  it("fails the exchange when the PKCE verifier doesn't match the plain challenge", async () => {
    const result = await login(h, async (req) => {
      // Swap the stored verifier for a different one before the callback runs.
      const state = req.query.get("state") ?? "";
      await h.db
        .update(oauthStates)
        .set({
          codeVerifierEnc: h.cipher.encrypt("x".repeat(64), `oauth_code_verifier:${state}`),
        })
        .where(eq(oauthStates.state, state));
    });

    expect(result.callbackResponse.headers.location).toBe("/?login_error=token_exchange_failed");
    expect(result.sessionCookie).toBeUndefined();
    expect(h.fakeMal.tokenGrants).toEqual(["authorization_code"]);
    const rows = await h.db.select().from(users);
    expect(rows).toHaveLength(0);
  });

  it("reports a declined consent screen", async () => {
    const start = await h.app.inject({ method: "GET", url: "/auth/mal/login" });
    const state = new URL(String(start.headers.location)).searchParams.get("state") ?? "";

    const res = await h.app.inject({
      method: "GET",
      url: `/auth/mal/callback?error=access_denied&state=${encodeURIComponent(state)}`,
      cookies: { [OAUTH_STATE_COOKIE]: state },
    });

    expect(res.headers.location).toBe("/?login_error=access_denied");
    expect(h.fakeMal.tokenGrants).toEqual([]);
  });
});

describe("token refresh", () => {
  it("refreshes an access token that is about to expire and stores the rotated pair", async () => {
    await loginOk();
    const id = await userId();
    await h.db
      .update(malTokens)
      .set({ accessExpiresAt: new Date(Date.now() + 60_000) }) // inside the 5-minute margin
      .where(eq(malTokens.userId, id));

    const token = await h.tokenStore.getValidAccessToken(id);

    expect(h.fakeMal.tokenGrants).toEqual(["authorization_code", "refresh_token"]);
    const [newAccess, newRefresh] = h.fakeMal.issuedSecrets.slice(-2);
    expect(token).toBe(newAccess);
    const [row] = await h.db.select().from(malTokens).where(eq(malTokens.userId, id));
    expect(h.cipher.decrypt(row?.refreshTokenEnc ?? "", `mal_refresh_token:${id}`)).toBe(
      newRefresh,
    );
    expect(row?.accessExpiresAt.getTime()).toBeGreaterThan(Date.now() + 60 * 60 * 1000);
  });

  it("returns the stored token without refreshing while it is still fresh", async () => {
    await loginOk();
    const id = await userId();

    await h.tokenStore.getValidAccessToken(id);

    expect(h.fakeMal.tokenGrants).toEqual(["authorization_code"]);
  });

  it("runs one refresh for concurrent callers (MAL rotates refresh tokens)", async () => {
    await loginOk();
    const id = await userId();
    await h.db
      .update(malTokens)
      .set({ accessExpiresAt: new Date(Date.now() - 1000) })
      .where(eq(malTokens.userId, id));

    const tokens = await Promise.all([
      h.tokenStore.getValidAccessToken(id),
      h.tokenStore.getValidAccessToken(id),
      h.tokenStore.refresh(id),
    ]);

    expect(new Set(tokens).size).toBe(1);
    expect(h.fakeMal.tokenGrants.filter((g) => g === "refresh_token")).toHaveLength(1);
  });

  it("flags the user for re-login when MAL rejects the refresh token", async () => {
    const cookie = await loginOk();
    const id = await userId();
    h.fakeMal.revokeRefreshTokens();

    await expect(h.tokenStore.refresh(id)).rejects.toBeInstanceOf(ReauthRequiredError);

    const [row] = await h.db.select().from(malTokens).where(eq(malTokens.userId, id));
    expect(row?.needsReauth).toBe(true);
    await expect(h.tokenStore.getValidAccessToken(id)).rejects.toBeInstanceOf(ReauthRequiredError);

    const me = await h.app.inject({
      method: "GET",
      url: "/me",
      cookies: { [SESSION_COOKIE]: cookie },
    });
    expect(me.json()).toMatchObject({ needsReauth: true });

    // Logging in again clears the flag.
    await loginOk();
    const [after] = await h.db.select().from(malTokens).where(eq(malTokens.userId, id));
    expect(after?.needsReauth).toBe(false);
  });
});

describe("sessions", () => {
  it("GET /me requires a valid session", async () => {
    const none = await h.app.inject({ method: "GET", url: "/me" });
    const bogus = await h.app.inject({
      method: "GET",
      url: "/me",
      cookies: { [SESSION_COOKIE]: "not-a-real-session" },
    });

    expect(none.statusCode).toBe(401);
    expect(bogus.statusCode).toBe(401);
  });

  it("expired sessions are rejected", async () => {
    const cookie = await loginOk();
    await h.db.update(sessions).set({ expiresAt: new Date(Date.now() - 1000) });

    const me = await h.app.inject({
      method: "GET",
      url: "/me",
      cookies: { [SESSION_COOKIE]: cookie },
    });
    expect(me.statusCode).toBe(401);
  });

  it("POST /auth/logout deletes the session and clears the cookie", async () => {
    const cookie = await loginOk();

    const res = await h.app.inject({
      method: "POST",
      url: "/auth/logout",
      headers: { origin: TEST_WEB_ORIGIN },
      cookies: { [SESSION_COOKIE]: cookie },
    });

    expect(res.statusCode).toBe(204);
    expect(res.cookies.find((c) => c.name === SESSION_COOKIE)?.value).toBe("");
    expect(await h.db.select().from(sessions)).toHaveLength(0);
    const me = await h.app.inject({
      method: "GET",
      url: "/me",
      cookies: { [SESSION_COOKIE]: cookie },
    });
    expect(me.statusCode).toBe(401);
  });

  it("POST /auth/logout rejects cross-origin requests", async () => {
    const cookie = await loginOk();

    const foreign = await h.app.inject({
      method: "POST",
      url: "/auth/logout",
      headers: { origin: "https://evil.example" },
      cookies: { [SESSION_COOKIE]: cookie },
    });
    const missing = await h.app.inject({
      method: "POST",
      url: "/auth/logout",
      cookies: { [SESSION_COOKIE]: cookie },
    });

    expect(foreign.statusCode).toBe(403);
    expect(missing.statusCode).toBe(403);
    expect(await h.db.select().from(sessions)).toHaveLength(1);
  });
});

describe("logging", () => {
  it("never writes OAuth codes, verifiers, tokens or session cookies to the logs", async () => {
    // Exercise every path that handles a secret, in addition to the tests above.
    await loginOk();
    const id = await userId();
    await h.tokenStore.refresh(id);
    await login(h, (req) => {
      req.query.set("code", "bogus-code");
    });
    h.fakeMal.revokeRefreshTokens();
    await h.tokenStore.refresh(id).catch(() => undefined);

    const logs = h.logs.text;
    // Sanity check that logging was captured at all.
    expect(logs).toContain("MAL login succeeded");

    const secrets = [...h.fakeMal.issuedSecrets, ...sessionCookies].filter((s) => s.length > 0);
    expect(secrets.length).toBeGreaterThan(10);
    for (const secret of secrets) {
      expect(logs).not.toContain(secret);
    }
  });
});
