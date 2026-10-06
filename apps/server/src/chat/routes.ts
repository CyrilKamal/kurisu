import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";

import { requireSameOrigin, requireUser } from "../auth/guards.js";
import type { Config } from "../config.js";
import { commitProposal } from "../writes/commit.js";
import { cancelProposal, undoChange } from "../writes/undo.js";
import {
  ConversationNotFoundError,
  deleteConversation,
  findConversation,
  handleChatMessage,
  listConversations,
  loadChange,
  loadChanges,
  loadThread,
  type ChatDeps,
} from "./service.js";

const messageBody = z.object({
  text: z.string().trim().min(1).max(1000),
  // Omitted to start a new chat.
  conversationId: z.uuid().optional(),
});
const idParams = z.object({ id: z.uuid() });

/** Per-user limits that keep a chatty session inside the free model quota. */
const MESSAGES_PER_MINUTE = 10;

export function registerChatRoutes(
  app: FastifyInstance,
  deps: ChatDeps & { config: Config },
): void {
  const { config, db } = deps;
  const guards = { preHandler: [requireSameOrigin(config.webOrigin), requireUser(db)] };
  const writeDeps = { db, writeListStatus: deps.writeListStatus };
  const recent = new Map<string, number[]>();
  const busy = new Set<string>();

  const userOf = (request: { user: { id: string } | null }) => {
    if (!request.user) throw new Error("requireUser did not set request.user");
    return request.user.id;
  };

  app.get("/chat/conversations", { preHandler: requireUser(db) }, async (request) => ({
    conversations: await listConversations(db, userOf(request)),
  }));

  app.get("/chat/conversations/:id", { preHandler: requireUser(db) }, async (request, reply) => {
    const userId = userOf(request);
    const params = idParams.safeParse(request.params);
    const conversation = params.success ? await findConversation(db, userId, params.data.id) : null;
    if (!conversation) return reply.code(404).send({ error: "not_found" });
    return { conversation, messages: await loadThread(db, userId, conversation.id) };
  });

  app.delete("/chat/conversations/:id", guards, async (request, reply) => {
    const params = idParams.safeParse(request.params);
    const deleted =
      params.success && (await deleteConversation(db, userOf(request), params.data.id));
    if (!deleted) return reply.code(404).send({ error: "not_found" });
    return reply.code(204).send();
  });

  app.post("/chat/messages", guards, async (request, reply) => {
    const userId = userOf(request);
    const body = messageBody.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "invalid_message" });

    const now = Date.now();
    const window = (recent.get(userId) ?? []).filter((t) => now - t < 60_000);
    if (window.length >= MESSAGES_PER_MINUTE) {
      return reply.code(429).send({ error: "too_many_messages" });
    }
    if (busy.has(userId)) return reply.code(409).send({ error: "busy" });
    recent.set(userId, [...window, now]);

    busy.add(userId);
    try {
      const { conversationId, userMessageId, assistantMessageId } = await handleChatMessage(
        deps,
        userId,
        body.data.text,
        body.data.conversationId ?? null,
      );
      const conversation = await findConversation(db, userId, conversationId);
      if (!conversation) throw new Error("the chat was deleted while answering");
      return {
        conversation,
        messages: await loadThread(db, userId, conversationId, 2, [
          userMessageId,
          assistantMessageId,
        ]),
      };
    } catch (err) {
      if (err instanceof ConversationNotFoundError) {
        return reply.code(404).send({ error: "not_found" });
      }
      throw err;
    } finally {
      busy.delete(userId);
    }
  });

  app.post("/proposals/:id/confirm", guards, async (request, reply) => {
    const userId = userOf(request);
    const params = idParams.safeParse(request.params);
    if (!params.success) return reply.code(404).send({ error: "not_found" });

    const result = await commitProposal(writeDeps, userId, params.data.id, { confirmed: true });
    if (result.status === "committed") {
      return { change: await loadChange(db, userId, result.change.id) };
    }
    return writeError(reply, result.status === "failed" ? result.error : result.status);
  });

  app.post("/proposals/:id/cancel", guards, async (request, reply) => {
    const userId = userOf(request);
    const params = idParams.safeParse(request.params);
    if (!params.success) return reply.code(404).send({ error: "not_found" });

    const result = await cancelProposal(db, userId, params.data.id);
    if (result === "cancelled") return reply.code(204).send();
    return writeError(reply, result === "not_found" ? "not_found" : "not_cancellable");
  });

  app.post("/changes/:id/undo", guards, async (request, reply) => {
    const userId = userOf(request);
    const params = idParams.safeParse(request.params);
    if (!params.success) return reply.code(404).send({ error: "not_found" });

    const result = await undoChange(writeDeps, userId, params.data.id);
    if (result.status === "committed") {
      return { change: await loadChange(db, userId, result.change.id) };
    }
    return writeError(reply, result.status === "failed" ? result.error : result.status);
  });

  app.get("/changes", { preHandler: requireUser(db) }, async (request) => ({
    changes: await loadChanges(db, userOf(request)),
  }));
}

/** Maps write-path outcomes to HTTP: missing → 404, MAL trouble → 502, the rest → 409. */
function writeError(reply: FastifyReply, error: string) {
  const status =
    error === "not_found"
      ? 404
      : ["mal_unavailable", "invalid_response", "internal_error"].includes(error)
        ? 502
        : 409;
  return reply.code(status).send({ error });
}
