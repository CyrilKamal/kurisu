import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { requireSameOrigin, requireUser } from "../auth/guards.js";
import type { Config } from "../config.js";
import { briefSettings } from "../db/schema.js";
import { AniListUnavailableError, runBrief, type BriefDeps } from "./service.js";
import { STREAMING_SERVICE_IDS } from "./services.js";
import { isValidTimeZone } from "./timing.js";

/** Why a brief request didn't go through; mirrored by BRIEF_ERRORS in @kurisu/shared. */
export type BriefErrorCode =
  "invalid_settings" | "too_soon" | "anilist_unavailable" | "push_disabled";

const fail = (error: BriefErrorCode) => ({ error });

const settingsBody = z.object({
  enabled: z.boolean(),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  timeZone: z.string().min(1).max(64).refine(isValidTimeZone),
  services: z
    .array(z.string().refine((id) => STREAMING_SERVICE_IDS.includes(id)))
    .max(STREAMING_SERVICE_IDS.length)
    .transform((ids) => [...new Set(ids)]),
});

/** What the settings page shows before the user has saved anything. */
const DEFAULT_SETTINGS = {
  enabled: false,
  time: "08:00",
  timeZone: "UTC",
  services: [] as string[],
};

/** A test brief calls AniList and the model, so once a minute is plenty. */
const TEST_COOLDOWN_MS = 60_000;

export function registerBriefRoutes(
  app: FastifyInstance,
  deps: BriefDeps & { config: Config },
): void {
  const { config, db } = deps;
  const read = { preHandler: requireUser(db) };
  const write = { preHandler: [requireSameOrigin(config.webOrigin), requireUser(db)] };
  const lastTest = new Map<string, number>();

  const userOf = (request: { user: { id: string } | null }) => {
    if (!request.user) throw new Error("requireUser did not set request.user");
    return request.user.id;
  };

  app.get("/brief/settings", read, async (request) => {
    const [row] = await db
      .select()
      .from(briefSettings)
      .where(eq(briefSettings.userId, userOf(request)));
    return row
      ? {
          enabled: row.enabled,
          time: row.localTime,
          timeZone: row.timeZone,
          services: row.services,
        }
      : DEFAULT_SETTINGS;
  });

  app.put("/brief/settings", write, async (request, reply) => {
    const userId = userOf(request);
    const body = settingsBody.safeParse(request.body);
    if (!body.success) return reply.code(400).send(fail("invalid_settings"));
    const { enabled, time, timeZone, services } = body.data;
    const values = { enabled, localTime: time, timeZone, services, updatedAt: new Date() };
    await db
      .insert(briefSettings)
      .values({ userId, ...values })
      .onConflictDoUpdate({ target: briefSettings.userId, set: values });
    return { enabled, time, timeZone, services };
  });

  app.post("/brief/test", write, async (request, reply) => {
    const userId = userOf(request);
    if (!deps.push.publicKey) return reply.code(503).send(fail("push_disabled"));
    const now = Date.now();
    const last = lastTest.get(userId);
    if (last !== undefined && now - last < TEST_COOLDOWN_MS) {
      return reply.code(429).send(fail("too_soon"));
    }
    lastTest.set(userId, now);

    try {
      const outcome = await runBrief(deps, userId, { kind: "test" });
      return {
        status: outcome.status === "empty" ? "empty" : "sent",
        episodes: outcome.episodes,
        push: outcome.push,
      };
    } catch (err) {
      if (err instanceof AniListUnavailableError) {
        return reply.code(502).send(fail("anilist_unavailable"));
      }
      throw err;
    }
  });
}
