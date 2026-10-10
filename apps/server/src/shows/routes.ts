import { SEARCH_MAX_CHARS } from "@kurisu/shared";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";

import { requireUser } from "../auth/guards.js";
import type { Db } from "../db/client.js";
import { loadJournal } from "../journal/load.js";
import { loadToday } from "../today/load.js";
import { searchShows, type SearchDeps } from "./search.js";
import { loadShow, type ShowDeps } from "./show.js";

export interface ShowRouteDeps extends ShowDeps, SearchDeps {
  db: Db;
}

/** Searches one user can make in a minute: each is an AniList request, shared by everyone. */
export const SEARCHES_PER_MINUTE = 20;
const MINUTE_MS = 60_000;

const animeParams = z.object({ animeId: z.coerce.number().int().positive() });
const searchQuery = z.object({ q: z.string().optional() });

function userOf(request: FastifyRequest): string {
  if (!request.user) throw new Error("requireUser did not set request.user");
  return request.user.id;
}

/** Today, the Journal, show pages and Search: reads only, apart from Search's AniList call. */
export function registerShowRoutes(app: FastifyInstance, deps: ShowRouteDeps): void {
  const { db } = deps;
  const read = { preHandler: requireUser(db) };

  app.get("/today", read, async (request) => loadToday(db, userOf(request), new Date()));

  app.get("/journal", read, async (request) => loadJournal(db, userOf(request)));

  app.get("/shows/:animeId", read, async (request, reply) => {
    const params = animeParams.safeParse(request.params);
    if (!params.success) return reply.code(404).send({ error: "not_found" });
    const show = await loadShow(deps, userOf(request), params.data.animeId, new Date());
    if (!show) return reply.code(404).send({ error: "not_found" });
    return show;
  });

  // Each user's recent searches, to keep one person from using up the shared AniList pace.
  const recent = new Map<string, number[]>();
  app.get("/search", read, async (request, reply) => {
    const userId = userOf(request);
    const parsed = searchQuery.safeParse(request.query);
    const query = (parsed.success ? (parsed.data.q ?? "") : "").trim().slice(0, SEARCH_MAX_CHARS);
    if (query !== "") {
      const now = Date.now();
      const times = (recent.get(userId) ?? []).filter((t) => now - t < MINUTE_MS);
      if (times.length >= SEARCHES_PER_MINUTE) {
        recent.set(userId, times);
        return reply.code(429).send({ error: "rate_limited" });
      }
      recent.set(userId, [...times, now]);
    }
    try {
      return { query, results: await searchShows(deps, userId, query) };
    } catch (err) {
      request.log.warn({ err: { name: (err as Error).name } }, "search failed");
      return reply.code(502).send({ error: "search_unavailable" });
    }
  });
}
