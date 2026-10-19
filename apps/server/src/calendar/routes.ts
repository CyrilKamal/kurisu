import type { CalendarResponse } from "@kurisu/shared";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";

import { requireSameOrigin, requireUser } from "../auth/guards.js";
import type { Limits } from "../billing/limits.js";
import type { Config } from "../config.js";
import type { TokenCipher } from "../crypto/tokenCipher.js";
import type { Db } from "../db/client.js";
import {
  FEED_TOKEN,
  feedCalendar,
  feedEpisodes,
  fetchFeedOwner,
  makeFeed,
  readFeed,
  removeFeed,
  userServices,
  type Feed,
} from "./feed.js";

export interface CalendarRouteDeps {
  config: Config;
  db: Db;
  cipher: TokenCipher;
  limits: Limits;
  /** Brings the user's airing data up to date in the background, when it's old. */
  refreshAiring: (userId: string) => void;
}

const fileParams = z.object({ file: z.string().max(64) });

function userOf(request: FastifyRequest): string {
  if (!request.user) throw new Error("requireUser did not set request.user");
  return request.user.id;
}

/**
 * The calendar feed (Milestone 8, Pro): Settings turns a secret link on, replaces it or turns it
 * off, and calendar apps fetch it without a session, by the link's token alone.
 */
export function registerCalendarRoutes(app: FastifyInstance, deps: CalendarRouteDeps): void {
  const { config, db, cipher, limits } = deps;
  const read = { preHandler: requireUser(db) };
  const write = { preHandler: [requireSameOrigin(config.webOrigin), requireUser(db)] };

  const view = (included: boolean, feed: Feed | null): CalendarResponse => {
    if (!feed) return { included, feed: null };
    const url = `${config.webOrigin}/api/calendar/feed/${feed.token}.ics`;
    return {
      included,
      feed: {
        url,
        webcalUrl: url.replace(/^https?:/, "webcal:"),
        lastFetchedAt: feed.lastFetchedAt?.toISOString() ?? null,
      },
    };
  };

  app.get("/calendar", read, async (request) => {
    const userId = userOf(request);
    return view(await limits.has(userId, "calendar"), await readFeed(db, cipher, userId));
  });

  /** Turns the feed on, or replaces its link: the old one stops working. */
  app.post("/calendar", write, async (request, reply) => {
    const userId = userOf(request);
    if (!(await limits.has(userId, "calendar"))) {
      return reply.code(403).send({ error: "needs_plan", feature: "calendar", plan: "pro" });
    }
    return view(true, await makeFeed(db, cipher, userId));
  });

  app.delete("/calendar", write, async (request) => {
    const userId = userOf(request);
    await removeFeed(db, userId);
    return view(await limits.has(userId, "calendar"), null);
  });

  /** What calendar apps fetch: `<token>.ics`. Unknown links are 404s. */
  app.get("/calendar/feed/:file", async (request, reply) => {
    const params = fileParams.safeParse(request.params);
    const token = params.success ? params.data.file.replace(/\.ics$/, "") : "";
    const now = new Date();
    const userId = FEED_TOKEN.test(token) ? await fetchFeedOwner(db, token, now) : null;
    if (!userId) return reply.code(404).send({ error: "not_found" });

    const included = await limits.has(userId, "calendar");
    if (included) deps.refreshAiring(userId);
    const body = feedCalendar({
      episodes: included ? await feedEpisodes(db, userId, now) : [],
      services: included ? await userServices(db, userId) : [],
      webOrigin: config.webOrigin,
      included,
      now,
    });
    return reply
      .header("content-type", "text/calendar; charset=utf-8")
      .header("content-disposition", 'inline; filename="kurisu.ics"')
      .header("cache-control", "private, max-age=900")
      .send(body);
  });
}
