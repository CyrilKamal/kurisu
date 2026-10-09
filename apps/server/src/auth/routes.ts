import { timingSafeEqual } from "node:crypto";

import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import type { Config } from "../config.js";
import type { TokenCipher } from "../crypto/tokenCipher.js";
import type { Db } from "../db/client.js";
import { malTokens, users } from "../db/schema.js";
import { findOpenInvite, useInvite } from "../invites/invites.js";
import { fetchMe } from "../mal/client.js";
import { buildAuthorizeUrl, exchangeCode, type MalOAuthConfig } from "../mal/oauth.js";
import { latestSyncRun, type ListSync } from "../sync/listSync.js";
import { toLastSync } from "../sync/summary.js";
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
  | "mal_unavailable"
  | "invite_only";

const loginQuerySchema = z.object({ invite: z.string().min(1).max(128).optional() });

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
  listSync: ListSync;
}

export function registerAuthRoutes(app: FastifyInstance, deps: AuthRouteDeps): void {
  const { config, db, cipher, tokenStore, listSync } = deps;
  const oauth: MalOAuthConfig = { ...config.mal };
  const cookieBase = {
    httpOnly: true,
    sameSite: "lax",
    secure: config.nodeEnv === "production",
    path: "/",
  } as const;

  app.get("/auth/mal/login", async (request, reply) => {
    await deleteExpiredOAuthStates(db);
    // A login from an invite link carries the invite to the callback. One that's expired or used
    // is dropped here; the callback then treats the login like any other.
    const query = loginQuerySchema.safeParse(request.query);
    const invite =
      query.success && query.data.invite ? await findOpenInvite(db, query.data.invite) : null;
    const { state, codeChallenge } = await createOAuthState(db, cipher, invite?.id ?? null);
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

    const pending = await consumeOAuthState(db, cipher, state);
    if (pending === null) return fail("invalid_state");

    let tokens;
    try {
      tokens = await exchangeCode(oauth, { code, codeVerifier: pending.codeVerifier });
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

    // While sign-up is closed (OWNER_MAL_USERNAME set), a new account must be the owner's or
    // come from an invite. Refused logins drop the tokens MAL just issued, unstored.
    const closed = config.owner !== null;
    const isOwner = config.owner !== null && sameName(me.name, config.owner.malUsername);
    const isNew = (await findUserId(db, me.id)) === null;
    const refuse = () => {
      request.log.info("sign-up refused: kurisu is invite-only");
      return fail("invite_only");
    };
    if (closed && isNew && !isOwner && pending.inviteId === null) return refuse();

    let userId: string;
    try {
      userId = await db.transaction(async (tx) => {
        const [user] = await tx
          .insert(users)
          .values({ malUserId: me.id, malUsername: me.name, isOwner })
          .onConflictDoUpdate({
            target: users.malUserId,
            set: { malUsername: me.name, isOwner, updatedAt: new Date() },
          })
          .returning({ id: users.id });
        if (!user) throw new Error("user upsert returned no row");
        // A new account uses up its invite, in the same transaction, so a link that was used
        // or revoked since the login started leaves no account behind.
        if (isNew && pending.inviteId !== null) {
          const used = await useInvite(tx, pending.inviteId, user.id);
          if (!used && closed && !isOwner) throw new InviteUnavailableError();
        }
        await tokenStore.save(user.id, tokens, tx);
        return user.id;
      });
    } catch (err) {
      if (err instanceof InviteUnavailableError) return refuse();
      throw err;
    }

    await deleteExpiredSessions(db);
    const session = await createSession(db, userId);
    reply.setCookie(SESSION_COOKIE, session.token, {
      ...cookieBase,
      maxAge: SESSION_TTL_MS / 1000,
    });
    request.log.info({ userId }, "MAL login succeeded");

    // Sync on login, so the List screen opens on fresh data. A failed sync doesn't fail the
    // login: the run is recorded and the List screen offers a retry.
    await listSync.run(userId, "login");
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

  /** Deletes the account and everything kurisu holds for it. The MAL list isn't touched. */
  app.delete(
    "/me",
    { preHandler: [requireSameOrigin(config.webOrigin), requireUser(db)] },
    async (request, reply) => {
      const user = request.user;
      if (!user) throw new Error("requireUser did not set request.user");
      // Every per-user table cascades from users.
      await db.delete(users).where(eq(users.id, user.id));
      reply.clearCookie(SESSION_COOKIE, cookieBase);
      request.log.info({ userId: user.id }, "account deleted");
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
      user: { malUsername: user.malUsername, isOwner: user.isOwner },
      needsReauth: tokens?.needsReauth ?? true,
      lastSync: toLastSync(await latestSyncRun(db, user.id)),
    };
  });
}

/** Thrown inside the sign-up transaction when its invite can't be used any more. */
class InviteUnavailableError extends Error {}

/** MAL usernames aren't case-sensitive. */
function sameName(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

async function findUserId(db: Db, malUserId: number): Promise<string | null> {
  const [row] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.malUserId, malUserId))
    .limit(1);
  return row?.id ?? null;
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
