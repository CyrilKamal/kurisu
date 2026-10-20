import { TOP_CHARTS } from "@kurisu/shared";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";

import { requireUser } from "../auth/guards.js";
import type { Db } from "../db/client.js";
import type { SeasonArchive } from "./archive.js";
import { loadSchedule, loadSeasonChart, loadTopChart } from "./load.js";
import { ARCHIVE_MAX_AGE_MS } from "./refresh.js";
import { chartedSeasons, compareSeasons, parseSeasonParam } from "./seasons.js";

export interface BrowseRouteDeps {
  db: Db;
  /** Rebuilds the shared schedule and charts in the background when they're stale. */
  refresh: () => void;
  /** Fetches an earlier season's chart in the background when someone asks for it. */
  archive: SeasonArchive;
}

const seasonQuery = z.object({ season: z.string().max(16).optional() });
const topQuery = z.object({ chart: z.enum(TOP_CHARTS).default("trending") });

function userOf(request: FastifyRequest): string {
  if (!request.user) throw new Error("requireUser did not set request.user");
  return request.user.id;
}

/**
 * Browse (Milestone 8's interlude): the week's airing schedule, the season charts and the Top
 * charts. They read shared tables that background jobs fill from AniList; opening Browse on stale
 * data starts a rebuild for the next visit, never one the page waits on, and an earlier season is
 * fetched in the background while the page checks back.
 */
export function registerBrowseRoutes(app: FastifyInstance, deps: BrowseRouteDeps): void {
  const { db } = deps;
  const read = { preHandler: requireUser(db) };

  app.get("/browse/schedule", read, async (request) => {
    deps.refresh();
    return loadSchedule(db, userOf(request));
  });

  app.get("/browse/seasons", read, async (request, reply) => {
    deps.refresh();
    const query = seasonQuery.safeParse(request.query);
    const asked = query.success && query.data.season ? parseSeasonParam(query.data.season) : null;
    if (query.success && query.data.season && !asked) {
      return reply.code(400).send({ error: "invalid_season" });
    }
    const now = new Date();
    const [last, current] = chartedSeasons(now);
    const season = asked ?? current;
    if (!season || !last) throw new Error("no current season");
    const chart = await loadSeasonChart(db, userOf(request), season, now);
    if (!chart) return reply.code(404).send({ error: "not_charted" });
    // Before last season: fetched on request, and again once it's a month old.
    const stale =
      chart.updatedAt === null || now.getTime() - Date.parse(chart.updatedAt) > ARCHIVE_MAX_AGE_MS;
    if (compareSeasons(season, last) < 0 && stale) deps.archive.request(season);
    return chart;
  });

  app.get("/browse/top", read, async (request, reply) => {
    deps.refresh();
    const query = topQuery.safeParse(request.query);
    if (!query.success) return reply.code(400).send({ error: "invalid_chart" });
    return loadTopChart(db, userOf(request), query.data.chart);
  });
}
