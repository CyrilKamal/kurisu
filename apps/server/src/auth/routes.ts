import { timingSafeEqual } from "node:crypto";

import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import type { Config } from "../config.js";
import type { TokenCipher } from "../crypto/tokenCipher.js";
import type { Db } from "../db/client.js";
import { malTokens, users } from "../db/schema.js";
import { fetchMe } from "../mal/client.js";
import { buildAuthorizeUrl, exchangeCode, type MalOAuthConfig } from "../mal/oauth.js";
import { requireSameOrigin, requireUser } from "./guards.js";
import {
  consumeOAuthState,
  createOAuthState,
  deleteExpiredOAuthStates,
  OAUTH_STATE_TTL_MS,
} from "./oauthStates.js";
import {
  createSession,
  deleteExpiredSessions,
  deleteSession,
  SESSION_COOKIE,
  SESSION_TTL_MS,
} from "./sessions.js";
import type { TokenStore } from "./tokenStore.js";

export const OAUTH_STATE_COOKIE = "kurisu_oauth_state";

/** Reasons a login can fail, passed to the web app as `/?login_error=<code>`. */
export type LoginError =
  | "access_denied"
  | "invalid_request"
  | "invalid_state"
  | "token_exchange_failed"
  | "mal_unavailable";

const callbackQuerySchema = z.object({
  code: z.string().min(1).max(4096).optional(),
  state: z.string().min(1).max(512).optional(),
  error: z.string().max(128).optional(),
});

export interface AuthRouteDeps {
  config: Config;
  db: Db;
  cipher: TokenCipher;
  tokenStore: TokenStore;
}

export function registerAuthRoutes(app: FastifyInstance, deps: AuthRouteDeps): void {
  const { config, db, cipher, tokenStore } = deps;
  const oauth: MalOAuthConfig = { ...config.mal };
  const cookieBase = {
    httpOnly: true,
    sameSite: "lax",
    secure: config.nodeEnv === "production",
    path: "/",
  } as const;

  app.get("/auth/mal/login", async (_request, reply) => {
    await deleteExpiredOAuthStates(db);
    const { state, codeChallenge } = await createOAuthState(db, cipher);
    // Binds the callback to this browser, so a login link can't be replayed from elsewhere.
    reply.setCookie(OAUTH_STATE_COOKIE, state, {
      ...cookieBase,
      maxAge: OAUTH_STATE_TTL_MS / 1000,
    });
    return reply.redirect(buildAuthorizeUrl(oauth, { state, codeChallenge }));
  });

  app.get("/auth/mal/callback", async (request, reply) => {
    const cookieState = request.cookies[OAUTH_STATE_COOKIE];
    reply.clearCookie(OAUTH_STATE_COOKIE, cookieBase);
    const fail = (code: LoginError) => reply.redirect(`/?login_error=${code}`);

    const query = callbackQuerySchema.safeParse(request.query);
    if (!query.success) return fail("invalid_request");
    const { code, state, error } = query.data;

    if (error !== undefined) {
      return fail(error === "access_denied" ? "access_denied" : "invalid_request");
    }
    if (!code || !state || !cookieState || !safeEqual(cookieState, state)) {
      return fail("invalid_state");
    }

    const codeVerifier = await consumeOAuthState(db, cipher, state);
    if (codeVerifier === null) return fail("invalid_state");

    let tokens;
    try {
      tokens = await exchangeCode(oauth, { code, codeVerifier });
    } catch (err) {
      request.log.warn({ err }, "MAL token exchange failed");
      return fail("token_exchange_failed");
    }

    let me;
    try {
      me = await fetchMe(config.mal.apiBaseUrl, tokens.accessToken);
    } catch (err) {
      request.log.warn({ err }, "MAL /users/@me failed after login");
      return fail("mal_unavailable");
    }

    const userId = await db.transaction(async (tx) => {
      const [user] = await tx
        .insert(users)
        .values({ malUserId: me.id, malUsername: me.name })
        .onConflictDoUpdate({
          target: users.malUserId,
          set: { malUsername: me.name, updatedAt: new Date() },
        })
        .returning({ id: users.id });
      if (!user) throw new Error("user upsert returned no row");
      await tokenStore.save(user.id, tokens, tx);
      return user.id;
    });

    await deleteExpiredSessions(db);
    const session = await createSession(db, userId);
    reply.setCookie(SESSION_COOKIE, session.token, {
      ...cookieBase,
      maxAge: SESSION_TTL_MS / 1000,
    });
    request.log.info({ userId }, "MAL login succeeded");
    return reply.redirect("/list");
  });

  app.post(
    "/auth/logout",
    { preHandler: requireSameOrigin(config.webOrigin) },
    async (request, reply) => {
      const token = request.cookies[SESSION_COOKIE];
      if (token) await deleteSession(db, token);
      reply.clearCookie(SESSION_COOKIE, cookieBase);
      return reply.code(204).send();
    },
  );

  app.get("/me", { preHandler: requireUser(db) }, async (request) => {
    const user = request.user;
    if (!user) throw new Error("requireUser did not set request.user");
    const [tokens] = await db
      .select({ needsReauth: malTokens.needsReauth })
      .from(malTokens)
      .where(eq(malTokens.userId, user.id))
      .limit(1);
    return {
      user: { malUsername: user.malUsername },
      needsReauth: tokens?.needsReauth ?? true,
    };
  });
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
