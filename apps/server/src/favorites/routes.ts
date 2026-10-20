import { favoritesOrderRequestSchema, type FavoritesResponse } from "@kurisu/shared";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";

import { requireSameOrigin, requireUser } from "../auth/guards.js";
import type { Config } from "../config.js";
import type { Db } from "../db/client.js";
import { addFavorite, listFavorites, removeFavorite, reorderFavorites } from "./favorites.js";

const showParams = z.object({ animeId: z.coerce.number().int().positive() });

function userOf(request: FastifyRequest): string {
  if (!request.user) throw new Error("requireUser did not set request.user");
  return request.user.id;
}

/**
 * The user's favorite shows (up to 10, kept by kurisu): a heart on a show's page adds or removes
 * one, and You puts them in order. Friends see them on their page while sharing is on.
 */
export function registerFavoriteRoutes(app: FastifyInstance, deps: { config: Config; db: Db }) {
  const { config, db } = deps;
  const read = { preHandler: requireUser(db) };
  const write = { preHandler: [requireSameOrigin(config.webOrigin), requireUser(db)] };
  const view = async (userId: string): Promise<FavoritesResponse> => ({
    favorites: await listFavorites(db, userId),
  });

  app.get("/favorites", read, (request) => view(userOf(request)));

  app.put("/favorites/:animeId", write, async (request, reply) => {
    const userId = userOf(request);
    const params = showParams.safeParse(request.params);
    if (!params.success) return reply.code(404).send({ error: "unknown_anime" });
    const result = await addFavorite(db, userId, params.data.animeId);
    if (result === "unknown_anime") return reply.code(404).send({ error: result });
    if (result === "favorites_full") return reply.code(409).send({ error: result });
    return view(userId);
  });

  app.delete("/favorites/:animeId", write, async (request, reply) => {
    const userId = userOf(request);
    const params = showParams.safeParse(request.params);
    if (!params.success) return reply.code(404).send({ error: "unknown_anime" });
    await removeFavorite(db, userId, params.data.animeId);
    return view(userId);
  });

  /** The same favorites in a new order. */
  app.put("/favorites", write, async (request, reply) => {
    const userId = userOf(request);
    const body = favoritesOrderRequestSchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "invalid_order" });
    const result = await reorderFavorites(db, userId, body.data.animeIds);
    if (result === "not_the_same") return reply.code(409).send({ error: result });
    return view(userId);
  });
}
