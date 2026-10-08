import type { FastifyReply } from "fastify";

/** Maps write-path outcomes to HTTP: missing → 404, MAL trouble → 502, the rest → 409. */
export function writeError(reply: FastifyReply, error: string) {
  const status =
    error === "not_found"
      ? 404
      : ["mal_unavailable", "invalid_response", "internal_error"].includes(error)
        ? 502
        : 409;
  return reply.code(status).send({ error });
}
