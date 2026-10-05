import { and, eq, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { requireSameOrigin, requireUser } from "../auth/guards.js";
import type { Config } from "../config.js";
import type { Db } from "../db/client.js";
import { pushSubscriptions } from "../db/schema.js";
import { isAllowedPushEndpoint, type PushSender } from "./send.js";

/** Why a push request didn't go through; mirrored by PUSH_ERRORS in @kurisu/shared. */
export type PushErrorCode =
  | "push_disabled"
  | "invalid_subscription"
  | "unsupported_push_service"
  | "too_soon"
  | "no_subscriptions";

const fail = (error: PushErrorCode) => ({ error });

const base64url = z.string().regex(/^[A-Za-z0-9_-]+=*$/);

/** The shape of `PushSubscription.toJSON()` in the browser. */
const subscriptionBody = z.object({
  endpoint: z.string().max(2048),
  expirationTime: z.number().nullish(),
  keys: z.object({ p256dh: base64url.max(200), auth: base64url.max(100) }),
});
const unsubscribeBody = z.object({ endpoint: z.string().max(2048) });

/** One test notification a minute per user is plenty. */
const TEST_COOLDOWN_MS = 60_000;

export function registerPushRoutes(
  app: FastifyInstance,
  deps: { config: Config; db: Db; push: PushSender; extraOrigins?: string[] },
): void {
  const { config, db, push } = deps;
  const read = { preHandler: requireUser(db) };
  const write = { preHandler: [requireSameOrigin(config.webOrigin), requireUser(db)] };
  const lastTest = new Map<string, number>();

  const userOf = (request: { user: { id: string } | null }) => {
    if (!request.user) throw new Error("requireUser did not set request.user");
    return request.user.id;
  };

  app.get("/push/public-key", read, () => ({ publicKey: push.publicKey }));

  app.post("/push/subscriptions", write, async (request, reply) => {
    const userId = userOf(request);
    if (!push.publicKey) return reply.code(503).send(fail("push_disabled"));
    const body = subscriptionBody.safeParse(request.body);
    if (!body.success) return reply.code(400).send(fail("invalid_subscription"));
    const { endpoint, keys } = body.data;
    if (!isAllowedPushEndpoint(endpoint, deps.extraOrigins)) {
      return reply.code(400).send(fail("unsupported_push_service"));
    }

    // One browser has one endpoint; if another account used this browser before, it moves here.
    await db
      .insert(pushSubscriptions)
      .values({ userId, endpoint, p256dh: keys.p256dh, auth: keys.auth })
      .onConflictDoUpdate({
        target: pushSubscriptions.endpoint,
        set: { userId, p256dh: keys.p256dh, auth: keys.auth, createdAt: sql`now()` },
      });
    return { subscribed: true };
  });

  app.delete("/push/subscriptions", write, async (request, reply) => {
    const userId = userOf(request);
    const body = unsubscribeBody.safeParse(request.body);
    if (!body.success) return reply.code(400).send(fail("invalid_subscription"));
    await db
      .delete(pushSubscriptions)
      .where(
        and(
          eq(pushSubscriptions.userId, userId),
          eq(pushSubscriptions.endpoint, body.data.endpoint),
        ),
      );
    return { subscribed: false };
  });

  app.post("/push/test", write, async (request, reply) => {
    const userId = userOf(request);
    if (!push.publicKey) return reply.code(503).send(fail("push_disabled"));
    const now = Date.now();
    const last = lastTest.get(userId);
    if (last !== undefined && now - last < TEST_COOLDOWN_MS) {
      return reply.code(429).send(fail("too_soon"));
    }
    lastTest.set(userId, now);

    const result = await push.sendToUser(userId, {
      title: "Notifications are on",
      body: "Your morning brief will show up here.",
      url: "/chat",
      tag: "test",
    });
    if (result.sent === 0 && result.failed === 0) {
      return reply.code(409).send(fail("no_subscriptions"));
    }
    return result;
  });
}
