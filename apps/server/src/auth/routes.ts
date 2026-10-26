import { timingSafeEqual } from "node:crypto";

import {
  TERMS_VERSION,
  termsAcceptRequestSchema,
  scoreStyleRequestSchema,
  titleLanguageRequestSchema,
} from "@kurisu/shared";
import { and, eq, isNull } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { exportUserData } from "../account/export.js";
import type { Limits } from "../billing/limits.js";
import { planJson } from "../billing/routes.js";
import type { Config } from "../config.js";
import type { TokenCipher } from "../crypto/tokenCipher.js";
import type { Db } from "../db/client.js";
import { malTokens, users } from "../db/schema.js";
import { addFriendship } from "../friends/friendships.js";
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
  | "invite_only"
  | "consent_needed";

const loginQuerySchema = z.object({
  invite: z.string().min(1).max(128).optional(),
  // The terms version they ticked "18 or older" and "I accept" for, on the landing or invite page.
  consent: z.string().max(32).optional(),
});

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
  /** Plans (Milestone 8): /me says which one the user is on. */
  limits: Limits;
  /** How long a new account's trial lasts. */
  trialDays: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

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
    // Only the current terms count; an old page's version means they read older ones.
    const consent = query.success && query.data.consent === TERMS_VERSION ? TERMS_VERSION : null;
    const { state, codeChallenge } = await createOAuthState(
      db,
      cipher,
      invite?.id ?? null,
      consent,
    );
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

    // On a server with an owner, a new account other than the owner's needs an invite while
    // sign-up is closed (SIGNUP=invite), and must have said it's 18 or older and accepted the
    // terms first (the boxes on the landing and invite pages). Refused logins drop the tokens
    // MAL just issued, unstored.
    const closed = config.owner !== null && config.signup === "invite";
    const isOwner = config.owner !== null && sameName(me.name, config.owner.malUsername);
    const isNew = (await findUserId(db, me.id)) === null;
    const refuse = () => {
      request.log.info("sign-up refused: kurisu is invite-only");
      return fail("invite_only");
    };
    if (closed && isNew && !isOwner && pending.inviteId === null) return refuse();
    if (config.owner !== null && isNew && !isOwner && pending.consentVersion === null) {
      request.log.info("sign-up refused: the terms weren't accepted");
      return fail("consent_needed");
    }
    const now = new Date();
    const consent = pending.consentVersion
      ? { ageConfirmedAt: now, termsAcceptedAt: now, termsVersion: pending.consentVersion }
      : {};

    let userId: string;
    try {
      userId = await db.transaction(async (tx) => {
        const [user] = await tx
          .insert(users)
          // A new account starts with a trial; an existing one keeps what it had.
          .values({
            malUserId: me.id,
            malUsername: me.name,
            isOwner,
            trialEndsAt: isOwner ? null : new Date(now.getTime() + deps.trialDays * DAY_MS),
            ...consent,
          })
          .onConflictDoUpdate({
            target: users.malUserId,
            set: { malUsername: me.name, isOwner, updatedAt: now, ...consent },
          })
          .returning({ id: users.id });
        if (!user) throw new Error("user upsert returned no row");
        // A new account uses up its invite, in the same transaction, so a link that was used
        // or revoked since the login started leaves no account behind. The new user and the
        // person who invited them become friends.
        if (isNew && pending.inviteId !== null) {
          const inviter = await useInvite(tx, pending.inviteId, user.id);
          if (inviter === null && closed && !isOwner) throw new InviteUnavailableError();
          if (inviter !== null) {
            await addFriendship(tx, inviter, user.id, "invite");
            // Invited friends keep Premium until payments launch, as a longer trial: no
            // supporter badge, and the friends' model budget still applies.
            const until = config.inviteTrialUntil;
            if (!isOwner && until && until.getTime() > now.getTime() + deps.trialDays * DAY_MS) {
              await tx.update(users).set({ trialEndsAt: until }).where(eq(users.id, user.id));
            }
          }
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
    // A new account starts with the welcome steps; everyone else, with Today.
    return reply.redirect(isNew ? "/welcome" : "/today");
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

  /** "I'm 18 or older, and I accept these terms": recorded for the version they read. */
  app.post(
    "/me/terms",
    { preHandler: [requireSameOrigin(config.webOrigin), requireUser(db)] },
    async (request, reply) => {
      const user = request.user;
      if (!user) throw new Error("requireUser did not set request.user");
      const body = termsAcceptRequestSchema.safeParse(request.body);
      // Accepting an older version than the one in force doesn't count; the page reloads.
      if (!body.success || body.data.version !== TERMS_VERSION) {
        return reply.code(400).send({ error: "outdated_terms" });
      }
      const now = new Date();
      await db
        .update(users)
        .set({ ageConfirmedAt: now, termsAcceptedAt: now, termsVersion: TERMS_VERSION })
        .where(eq(users.id, user.id));
      return { termsAccepted: true };
    },
  );

  /** Which of a show's titles the app shows them. */
  app.put(
    "/me/title-language",
    { preHandler: [requireSameOrigin(config.webOrigin), requireUser(db)] },
    async (request, reply) => {
      const user = request.user;
      if (!user) throw new Error("requireUser did not set request.user");
      const body = titleLanguageRequestSchema.safeParse(request.body);
      if (!body.success) return reply.code(400).send({ error: "invalid_language" });
      await db
        .update(users)
        .set({ titleLanguage: body.data.language })
        .where(eq(users.id, user.id));
      return { titleLanguage: body.data.language };
    },
  );

  /** How scores look to them: 10 points, 100 points or 5 stars (MAL's 1–10 is what's saved). */
  app.put(
    "/me/score-style",
    { preHandler: [requireSameOrigin(config.webOrigin), requireUser(db)] },
    async (request, reply) => {
      const user = request.user;
      if (!user) throw new Error("requireUser did not set request.user");
      const body = scoreStyleRequestSchema.safeParse(request.body);
      if (!body.success) return reply.code(400).send({ error: "invalid_style" });
      await db.update(users).set({ scoreStyle: body.data.style }).where(eq(users.id, user.id));
      return { scoreStyle: body.data.style };
    },
  );

  /** Everything kurisu holds about the user, as a JSON file to keep (titles as stored). */
  app.get(
    "/me/export",
    { preHandler: requireUser(db), config: { titlesAsStored: true } },
    async (request, reply) => {
      const user = request.user;
      if (!user) throw new Error("requireUser did not set request.user");
      const now = new Date();
      const data = await exportUserData(
        db,
        user.id,
        planJson(await deps.limits.plan(user.id)),
        now,
      );
      const file = `kurisu-${user.malUsername}-${now.toISOString().slice(0, 10)}.json`;
      return reply
        .header("content-disposition", `attachment; filename="${file}"`)
        .header("cache-control", "no-store")
        .send(data);
    },
  );

  /** The user finished or skipped the welcome steps; they don't come back. */
  app.post(
    "/me/welcomed",
    { preHandler: [requireSameOrigin(config.webOrigin), requireUser(db)] },
    async (request) => {
      const user = request.user;
      if (!user) throw new Error("requireUser did not set request.user");
      await db
        .update(users)
        .set({ welcomedAt: new Date() })
        .where(and(eq(users.id, user.id), isNull(users.welcomedAt)));
      return { welcomed: true };
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
    const [account] = await db
      .select({
        welcomedAt: users.welcomedAt,
        shareActivity: users.shareActivity,
        ageConfirmedAt: users.ageConfirmedAt,
        termsVersion: users.termsVersion,
        scoreStyle: users.scoreStyle,
      })
      .from(users)
      .where(eq(users.id, user.id));
    return {
      user: {
        malUsername: user.malUsername,
        isOwner: user.isOwner,
        shareActivity: account?.shareActivity ?? true,
      },
      welcomed: account !== undefined && account.welcomedAt !== null,
      needsReauth: tokens?.needsReauth ?? true,
      lastSync: toLastSync(await latestSyncRun(db, user.id)),
      plan: planJson(await deps.limits.plan(user.id)),
      // A server without an owner asks no one; the owner wrote the terms.
      termsAccepted:
        config.owner === null ||
        user.isOwner ||
        (account?.termsVersion === TERMS_VERSION && account.ageConfirmedAt !== null),
      titleLanguage: user.titleLanguage,
      scoreStyle: account?.scoreStyle ?? "point_10",
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
