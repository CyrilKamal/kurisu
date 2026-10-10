import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";

import { requireOwner, requireSameOrigin, requireUser } from "../auth/guards.js";
import type { Config } from "../config.js";
import type { Db } from "../db/client.js";
import { createInvite, findOpenInvite, listInvites, revokeInvite } from "./invites.js";

export interface InviteRouteDeps {
  config: Config;
  db: Db;
}

const createBody = z
  .object({
    // A blank note is no note.
    note: z
      .string()
      .trim()
      .max(60)
      .transform((note) => (note === "" ? null : note))
      .optional(),
  })
  .strict();
const idParams = z.object({ id: z.uuid() });
const codeParams = z.object({ code: z.string().min(1).max(128) });

function userOf(request: FastifyRequest): string {
  if (!request.user) throw new Error("requireUser did not set request.user");
  return request.user.id;
}

export function registerInviteRoutes(app: FastifyInstance, deps: InviteRouteDeps): void {
  const { config, db } = deps;
  const ownerRead = { preHandler: [requireUser(db), requireOwner()] };
  const ownerWrite = {
    preHandler: [requireSameOrigin(config.webOrigin), requireUser(db), requireOwner()],
  };

  app.get("/invites", ownerRead, async (request) => ({
    invites: (await listInvites(db, userOf(request))).map(toJson),
  }));

  /** A new one-time link. Its code is returned only now; kurisu keeps just its hash. */
  app.post("/invites", ownerWrite, async (request, reply) => {
    const body = createBody.safeParse(request.body ?? {});
    if (!body.success) return reply.code(400).send({ error: "invalid_request" });
    const invite = await createInvite(db, userOf(request), body.data.note ?? null);
    return reply.code(201).send({
      id: invite.id,
      url: `${config.webOrigin}/invite/${invite.code}`,
      expiresAt: invite.expiresAt.toISOString(),
    });
  });

  app.delete("/invites/:id", ownerWrite, async (request, reply) => {
    const params = idParams.safeParse(request.params);
    if (!params.success) return reply.code(404).send({ error: "not_found" });
    const revoked = await revokeInvite(db, userOf(request), params.data.id);
    if (!revoked) return reply.code(404).send({ error: "not_found" });
    return reply.code(204).send();
  });

  /**
   * For the invite page, before anyone logs in: whether a link still works, and who sent it.
   * The code is the secret, so this needs no session.
   */
  app.get("/invites/code/:code", async (request, reply) => {
    const params = codeParams.safeParse(request.params);
    const invite = params.success ? await findOpenInvite(db, params.data.code) : null;
    if (!invite) return reply.code(404).send({ error: "not_found" });
    // Only the owner invites, so the page names them as they chose (OWNER_DISPLAY_NAME).
    return { inviter: config.owner?.displayName ?? invite.inviter };
  });
}

function toJson(invite: Awaited<ReturnType<typeof listInvites>>[number]) {
  return {
    ...invite,
    createdAt: invite.createdAt.toISOString(),
    expiresAt: invite.expiresAt.toISOString(),
  };
}
