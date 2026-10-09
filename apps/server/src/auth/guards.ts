import type { FastifyReply, FastifyRequest, preHandlerAsyncHookHandler } from "fastify";

import type { Db } from "../db/client.js";
import { findSessionUser, SESSION_COOKIE, type SessionUser } from "./sessions.js";

declare module "fastify" {
  interface FastifyRequest {
    /** Set by `requireUser`; null on routes that don't require a session. */
    user: SessionUser | null;
  }
}

/** Rejects requests without a valid session cookie; otherwise sets `request.user`. */
export function requireUser(db: Db): preHandlerAsyncHookHandler {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const token = request.cookies[SESSION_COOKIE];
    const user = token ? await findSessionUser(db, token) : null;
    if (!user) {
      return reply.code(401).send({ error: "unauthenticated" });
    }
    request.user = user;
  };
}

/** For the owner's routes (invites); runs after `requireUser`. Others get a 404. */
export function requireOwner(): preHandlerAsyncHookHandler {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.user?.isOwner) {
      return reply.code(404).send({ error: "not_found" });
    }
  };
}

/**
 * CSRF defense for state-changing routes, on top of SameSite=Lax cookies: the browser's Origin
 * header must be the web app's origin. Browsers always send Origin on POST.
 */
export function requireSameOrigin(webOrigin: string): preHandlerAsyncHookHandler {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (request.headers.origin !== webOrigin) {
      return reply.code(403).send({ error: "forbidden_origin" });
    }
  };
}
