import * as contract from "@kurisu/shared";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { runEpisodeAlerts, type AlertDeps } from "../../src/alerts/service.js";
import { createAniListClient } from "../../src/anilist/client.js";
import { SESSION_COOKIE } from "../../src/auth/sessions.js";
import { createLimits } from "../../src/billing/limits.js";
import { loadPlansFile } from "../../src/billing/plans.js";
import {
  anilistMedia,
  briefSettings,
  episodeAlerts,
  scheduleSlots,
  users,
} from "../../src/db/schema.js";
import { loadModelsFile } from "../../src/llm/modelConfig.js";
import { createPushSender, generateVapidKeys } from "../../src/push/send.js";
import { fixtureList } from "../fixtures/animeList.js";
import { airingMedia, FakeAniList } from "../support/fakeAniList.js";
import { FakePushService, type FakeBrowser } from "../support/fakePushService.js";
import {
  backgroundSettled,
  login,
  resetDatabase,
  startHarness,
  type Harness,
} from "../support/harness.js";
import { TEST_WEB_ORIGIN } from "../support/testConfig.js";

// The fixture's Watching show, on episode 7 of 12; AniList knows it as 501.
const WATCHING = 900001;
const ANILIST_ID = 501;
const HOUR_MS = 60 * 60 * 1000;
const vapid = generateVapidKeys();

let h: Harness;
let anilist: FakeAniList;
let pushService: FakePushService;
let browser: FakeBrowser;
let cookie: string;
let userId: string;
let deps: AlertDeps;

beforeAll(async () => {
  anilist = await FakeAniList.start();
  pushService = await FakePushService.start();
  h = await startHarness({
    env: {
      VAPID_PUBLIC_KEY: vapid.publicKey,
      VAPID_PRIVATE_KEY: vapid.privateKey,
      VAPID_SUBJECT: "mailto:test@example.com",
      ANILIST_API_URL: anilist.apiUrl,
    },
    pushOrigins: [pushService.origin],
  });
  deps = {
    db: h.db,
    anilist: createAniListClient({
      apiUrl: anilist.apiUrl,
      minIntervalMs: 0,
      retry: { retries: 1, baseDelayMs: 1, maxDelayMs: 5 },
    }),
    push: createPushSender({
      db: h.db,
      vapid: h.config.push,
      log: h.app.log,
      extraOrigins: [pushService.origin],
    }),
    // No owner here, as in development: every plan feature is on.
    limits: createLimits({
      db: h.db,
      models: loadModelsFile(),
      plans: loadPlansFile(),
      budget: null,
      limitsOn: false,
    }),
    log: h.app.log,
  };
});

afterAll(async () => {
  await h.close();
  await anilist.stop();
  await pushService.stop();
});

beforeEach(async () => {
  await resetDatabase(h.db);
  h.fakeMal.reset();
  anilist.reset();
  pushService.reset();
  h.fakeMal.list = fixtureList();

  const result = await login(h);
  if (!result.sessionCookie) throw new Error("login failed");
  cookie = result.sessionCookie;
  await backgroundSettled(h);
  const [user] = await h.db.select({ id: users.id }).from(users);
  if (!user) throw new Error("no user");
  userId = user.id;

  browser = pushService.browser("phone");
  expect((await send("POST", "/push/subscriptions", browser.subscription)).statusCode).toBe(200);
  expect(
    (
      await send("PUT", "/brief/settings", {
        enabled: false,
        time: "08:00",
        timeZone: "UTC",
        services: ["crunchyroll"],
      })
    ).statusCode,
  ).toBe(200);
  const on = await send("PUT", "/alerts", { on: true });
  expect(contract.alertsResponseSchema.parse(on.json())).toEqual({
    included: true,
    on: true,
    muted: [],
  });
  // Alerts were turned on a day ago, so the episode below aired after.
  await h.db
    .update(briefSettings)
    .set({ episodeAlertsSince: new Date(Date.now() - 24 * HOUR_MS) })
    .where(eq(briefSettings.userId, userId));
});

function send(method: "GET" | "POST" | "PUT", url: string, payload?: object) {
  return h.app.inject({
    method,
    url,
    headers: { origin: TEST_WEB_ORIGIN },
    cookies: { [SESSION_COOKIE]: cookie },
    ...(payload ? { payload: payload as Record<string, unknown> } : {}),
  });
}

/**
 * Episode 8 aired an hour ago by AniList's shared schedule, and kurisu last asked AniList about
 * the show two hours ago, when episode 8 was still next.
 */
async function episodeEightDue(): Promise<void> {
  const now = Date.now();
  await h.db.insert(scheduleSlots).values({
    anilistId: ANILIST_ID,
    malId: WATCHING,
    episode: 8,
    airingAt: new Date(now - HOUR_MS),
    popularity: 1000,
    fetchedAt: new Date(now - 2 * HOUR_MS),
  });
  await h.db
    .insert(anilistMedia)
    .values({
      malId: WATCHING,
      anilistId: ANILIST_ID,
      status: "RELEASING",
      episodes: 12,
      nextEpisode: 8,
      nextAiringAt: new Date(now - HOUR_MS),
      episodeOffset: 0,
      streamingLinks: [],
      fetchedAt: new Date(now - 2 * HOUR_MS),
    })
    .onConflictDoUpdate({
      target: anilistMedia.malId,
      set: {
        anilistId: ANILIST_ID,
        status: "RELEASING",
        nextEpisode: 8,
        nextAiringAt: new Date(now - HOUR_MS),
        episodeOffset: 0,
        streamingLinks: [],
        fetchedAt: new Date(now - 2 * HOUR_MS),
      },
    });
}

/** What AniList says when asked again: `next` is the episode it has coming. */
function aniListSays(next: { episode: number; inHours: number } | null, status = "RELEASING") {
  anilist.media = [
    airingMedia(ANILIST_ID, WATCHING, {
      status,
      nextAiringEpisode: next && {
        episode: next.episode,
        airingAt: Math.floor((Date.now() + next.inHours * HOUR_MS) / 1000),
      },
    }),
  ];
}

interface Sent {
  title: string;
  body: string;
  url: string;
  tag: string;
}

function pushes(): Sent[] {
  return pushService.received.map((push) => JSON.parse(browser.decrypt(push.body)) as Sent);
}

describe("episode alerts", () => {
  it("sends one push once AniList confirms the episode is out, and never twice", async () => {
    await episodeEightDue();
    aniListSays({ episode: 9, inHours: 24 * 7 - 1 });

    expect(await runEpisodeAlerts(deps)).toEqual({ sent: 1, unconfirmed: 0 });
    expect(pushes()).toEqual([
      {
        title: "Fixture Watching Show · Episode 8",
        body: "Out now on Crunchyroll",
        url: `/shows/${String(WATCHING)}`,
        tag: `episode:${String(WATCHING)}`,
      },
    ]);

    // The next run, a retried one, or one beside it: nothing new.
    expect(await runEpisodeAlerts(deps)).toEqual({ sent: 0, unconfirmed: 0 });
    expect(pushService.received).toHaveLength(1);
    expect(
      await h.db
        .select({ episode: episodeAlerts.episode })
        .from(episodeAlerts)
        .where(eq(episodeAlerts.userId, userId)),
    ).toEqual([{ episode: 8 }]);
  });

  it("sends once when two runs overlap", async () => {
    await episodeEightDue();
    aniListSays({ episode: 9, inHours: 24 });

    const runs = await Promise.all([runEpisodeAlerts(deps), runEpisodeAlerts(deps)]);
    expect(runs.reduce((sum, run) => sum + run.sent, 0)).toBe(1);
    expect(pushService.received).toHaveLength(1);
  });

  it("waits while AniList still has the episode coming (a delay)", async () => {
    await episodeEightDue();
    aniListSays({ episode: 8, inHours: 2 });

    expect(await runEpisodeAlerts(deps)).toEqual({ sent: 0, unconfirmed: 1 });
    expect(pushService.received).toHaveLength(0);
    expect(await h.db.select().from(episodeAlerts)).toEqual([]);
  });

  it("counts a finished show's last episodes as out", async () => {
    await episodeEightDue();
    aniListSays(null, "FINISHED");

    expect((await runEpisodeAlerts(deps)).sent).toBe(1);
  });

  it("sends nothing for an episode already watched, a muted show, or a plan without alerts", async () => {
    await episodeEightDue();
    aniListSays({ episode: 9, inHours: 24 });

    const muted = await send("PUT", `/alerts/shows/${String(WATCHING)}`, { muted: true });
    expect(contract.alertMuteResponseSchema.parse(muted.json())).toEqual({
      animeId: WATCHING,
      muted: true,
    });
    expect(
      contract.alertsResponseSchema.parse((await send("GET", "/alerts")).json()).muted,
    ).toEqual([WATCHING]);
    expect((await runEpisodeAlerts(deps)).sent).toBe(0);
    await send("PUT", `/alerts/shows/${String(WATCHING)}`, { muted: false });

    const free = { ...deps, limits: { ...deps.limits, has: () => Promise.resolve(false) } };
    expect((await runEpisodeAlerts(free)).sent).toBe(0);

    expect(
      (
        await send("POST", `/list/${String(WATCHING)}/edit`, {
          episodesWatched: 8,
          requestId: crypto.randomUUID(),
        })
      ).statusCode,
    ).toBe(200);
    expect((await runEpisodeAlerts(deps)).sent).toBe(0);
    expect(pushService.received).toHaveLength(0);
  });

  it("skips episodes from before alerts were turned on, and none when they're off", async () => {
    await episodeEightDue();
    aniListSays({ episode: 9, inHours: 24 });
    await h.db
      .update(briefSettings)
      .set({ episodeAlertsSince: new Date() })
      .where(eq(briefSettings.userId, userId));
    expect((await runEpisodeAlerts(deps)).sent).toBe(0);

    await h.db
      .update(briefSettings)
      .set({ episodeAlertsSince: new Date(Date.now() - 24 * HOUR_MS) })
      .where(eq(briefSettings.userId, userId));
    const off = await send("PUT", "/alerts", { on: false });
    expect(contract.alertsResponseSchema.parse(off.json()).on).toBe(false);
    expect((await runEpisodeAlerts(deps)).sent).toBe(0);
    expect(pushService.received).toHaveLength(0);
  });

  it("refuses an unknown show's mute and a malformed setting", async () => {
    expect((await send("PUT", "/alerts/shows/123456", { muted: true })).statusCode).toBe(404);
    expect((await send("PUT", "/alerts", { on: "yes" })).statusCode).toBe(400);
  });
});
