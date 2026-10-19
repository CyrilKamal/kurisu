import {
  waitlistJoinRequestSchema,
  waitlistLeaveRequestSchema,
  type SiteResponse,
} from "@kurisu/shared";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";

import { requireOwner, requireSameOrigin, requireUser } from "../auth/guards.js";
import type { Config } from "../config.js";
import type { Db } from "../db/client.js";
import {
  inviteFromWaitlist,
  joinWaitlist,
  leaveWaitlist,
  listWaitlist,
  removeFromWaitlist,
} from "./waitlist.js";

export interface WaitlistRouteDeps {
  config: Config;
  db: Db;
}

/** Joins the whole server takes in a minute: a flood stops here, whoever sends it. */
export const WAITLIST_JOINS_PER_MINUTE = 30;
/** A form sent sooner than this after it opened was sent by a bot. */
export const WAITLIST_MIN_FILL_MS = 1_500;
const MINUTE_MS = 60_000;

const idParams = z.object({ id: z.uuid() });

function userOf(request: FastifyRequest): string {
  if (!request.user) throw new Error("requireUser did not set request.user");
  return request.user.id;
}

export function registerWaitlistRoutes(app: FastifyInstance, deps: WaitlistRouteDeps): void {
  const { config, db } = deps;
  const publicWrite = { preHandler: [requireSameOrigin(config.webOrigin)] };
  const ownerRead = { preHandler: [requireUser(db), requireOwner()] };
  const ownerWrite = {
    preHandler: [requireSameOrigin(config.webOrigin), requireUser(db), requireOwner()],
  };

  /** For the public pages: who runs kurisu, how to reach them, and whether sign-up is open. */
  app.get("/site", (): SiteResponse => ({
    operator: config.owner?.displayName ?? null,
    contactEmail: config.contactEmail,
    signup: config.signup,
  }));

  const recentJoins: number[] = [];
  app.post("/waitlist", publicWrite, async (request, reply) => {
    const body = waitlistJoinRequestSchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "invalid_request" });

    // A bot filled in the field people never see, or sent the form at once: it's told it worked
    // and nothing is stored.
    const { website, elapsedMs } = body.data;
    if ((website ?? "") !== "" || (elapsedMs !== undefined && elapsedMs < WAITLIST_MIN_FILL_MS)) {
      return { status: "joined", leaveToken: null };
    }

    const now = Date.now();
    while (recentJoins.length > 0 && now - (recentJoins[0] ?? now) >= MINUTE_MS) {
      recentJoins.shift();
    }
    if (recentJoins.length >= WAITLIST_JOINS_PER_MINUTE) {
      return reply.code(429).send({ error: "rate_limited" });
    }
    recentJoins.push(now);

    const result = await joinWaitlist(db, {
      email: body.data.email,
      malUsername: body.data.malUsername ?? null,
    });
    if (result.status === "full") return reply.code(503).send({ error: "waitlist_full" });
    // The email is never logged; only that someone joined.
    request.log.info({ waitlist: result.status }, "waitlist");
    return result.status === "joined"
      ? { status: "joined", leaveToken: result.leaveToken }
      : { status: "already", leaveToken: null };
  });

  /** Always 204, so the endpoint doesn't say which tokens exist. */
  app.post("/waitlist/leave", publicWrite, async (request, reply) => {
    const body = waitlistLeaveRequestSchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "invalid_request" });
    await leaveWaitlist(db, body.data.token);
    return reply.code(204).send();
  });

  app.get("/waitlist", ownerRead, async () => ({
    entries: (await listWaitlist(db)).map((entry) => ({
      ...entry,
      createdAt: entry.createdAt.toISOString(),
      invitedAt: entry.invitedAt?.toISOString() ?? null,
    })),
  }));

  app.post("/waitlist/:id/invite", ownerWrite, async (request, reply) => {
    const params = idParams.safeParse(request.params);
    if (!params.success) return reply.code(404).send({ error: "not_found" });
    const invite = await inviteFromWaitlist(db, userOf(request), params.data.id);
    if (!invite) return reply.code(404).send({ error: "not_found" });
    return reply.code(201).send({
      url: `${config.webOrigin}/invite/${invite.code}`,
      expiresAt: invite.expiresAt.toISOString(),
    });
  });

  app.delete("/waitlist/:id", ownerWrite, async (request, reply) => {
    const params = idParams.safeParse(request.params);
    if (!params.success) return reply.code(404).send({ error: "not_found" });
    const removed = await removeFromWaitlist(db, params.data.id);
    if (!removed) return reply.code(404).send({ error: "not_found" });
    return reply.code(204).send();
  });
}
