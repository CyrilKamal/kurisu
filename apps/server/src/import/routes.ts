import { importCreateRequestSchema, importItemPatchSchema } from "@kurisu/shared";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";

import { requireSameOrigin, requireUser } from "../auth/guards.js";
import type { Config } from "../config.js";
import {
  discardImport,
  importBusy,
  latestImport,
  loadImport,
  runImport,
  startImport,
  undoImport,
  updateItem,
  type ImportDeps,
} from "./service.js";

const importParams = z.object({ id: z.uuid() });
const itemParams = z.object({ id: z.uuid(), itemId: z.uuid() });

function userOf(request: FastifyRequest): string {
  if (!request.user) throw new Error("requireUser did not set request.user");
  return request.user.id;
}

/** Import from notes: paste, review, Import, and undo, all through the single write path. */
export function registerImportRoutes(
  app: FastifyInstance,
  deps: ImportDeps & { config: Config },
): void {
  const { config, db } = deps;
  const read = { preHandler: requireUser(db) };
  const write = { preHandler: [requireSameOrigin(config.webOrigin), requireUser(db)] };

  app.post("/imports", write, async (request, reply) => {
    const body = importCreateRequestSchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "invalid" });
    const userId = userOf(request);
    // One import at a time: two writing at once could step on each other.
    if (await importBusy(db, userId)) return reply.code(409).send({ error: "busy" });
    const id = await startImport(deps, userId, body.data.text);
    return reply.code(202).send({ import: await loadImport(db, userId, id) });
  });

  app.get("/imports/latest", read, async (request) => ({
    import: await latestImport(db, userOf(request)),
  }));

  app.get("/imports/:id", read, async (request, reply) => {
    const params = importParams.safeParse(request.params);
    const found = params.success ? await loadImport(db, userOf(request), params.data.id) : null;
    if (!found) return reply.code(404).send({ error: "not_found" });
    return { import: found };
  });

  app.patch("/imports/:id/items/:itemId", write, async (request, reply) => {
    const params = itemParams.safeParse(request.params);
    if (!params.success) return reply.code(404).send({ error: "not_found" });
    const body = importItemPatchSchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "invalid" });
    const userId = userOf(request);
    const result = await updateItem(db, userId, params.data.id, params.data.itemId, body.data);
    if (result !== "ok") {
      const status = result === "not_found" ? 404 : result === "not_ready" ? 409 : 400;
      return reply.code(status).send({ error: result });
    }
    const view = await loadImport(db, userId, params.data.id);
    const item = view?.items.find((i) => i.id === params.data.itemId);
    return { item };
  });

  app.post("/imports/:id/run", write, async (request, reply) => {
    const params = importParams.safeParse(request.params);
    if (!params.success) return reply.code(404).send({ error: "not_found" });
    const userId = userOf(request);
    const result = await runImport(deps, userId, params.data.id);
    if (result !== "started") {
      return reply.code(result === "not_found" ? 404 : 409).send({ error: result });
    }
    return reply.code(202).send({ import: await loadImport(db, userId, params.data.id) });
  });

  app.post("/imports/:id/undo", write, async (request, reply) => {
    const params = importParams.safeParse(request.params);
    if (!params.success) return reply.code(404).send({ error: "not_found" });
    const userId = userOf(request);
    const result = await undoImport(deps, userId, params.data.id);
    if (result !== "started") {
      return reply.code(result === "not_found" ? 404 : 409).send({ error: result });
    }
    return reply.code(202).send({ import: await loadImport(db, userId, params.data.id) });
  });

  app.delete("/imports/:id", write, async (request, reply) => {
    const params = importParams.safeParse(request.params);
    const deleted = params.success && (await discardImport(db, userOf(request), params.data.id));
    if (!deleted) return reply.code(404).send({ error: "not_found" });
    return reply.code(204).send();
  });
}
