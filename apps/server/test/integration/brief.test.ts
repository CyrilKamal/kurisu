import { and, desc, eq } from "drizzle-orm";
import { PgBoss } from "pg-boss";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { inject } from "vitest";

import { createAniListClient } from "../../src/anilist/client.js";
import { SESSION_COOKIE } from "../../src/auth/sessions.js";
import { createBriefScheduler } from "../../src/brief/scheduler.js";
import {
  BriefPushError,
  briefSchedule,
  dueBriefs,
  runBrief,
  type BriefDeps,
} from "../../src/brief/service.js";
import {
  anilistMedia,
  anilistSequels,
  anime,
  briefs,
  briefSettings,
  chatMessages,
  conversations,
  proposals,
  pushSubscriptions,
  users,
} from "../../src/db/schema.js";
import { parseModelRef } from "../../src/llm/modelConfig.js";
import type { LlmMessage } from "../../src/llm/types.js";
import { createPushSender, generateVapidKeys } from "../../src/push/send.js";
import { fixtureList } from "../fixtures/animeList.js";
import { airingMedia, FakeAniList, relatedShow, streamingLink } from "../support/fakeAniList.js";
import { FakePushService, type FakeBrowser } from "../support/fakePushService.js";
import {
  backgroundSettled,
  login,
  resetDatabase,
  startHarness,
  type Harness,
} from "../support/harness.js";
import { ScriptedModels, type ScriptStep } from "../support/scriptedModels.js";
import { TEST_WEB_ORIGIN } from "../support/testConfig.js";

const AGENT = parseModelRef("ollama:test-agent");
const BRIEF = parseModelRef("ollama:test-brief");
const vapid = generateVapidKeys();

let h: Harness;
let anilist: FakeAniList;
let pushService: FakePushService;
let browser: FakeBrowser;
let cookie: string;
let userId: string;
const models = new ScriptedModels();

/** The brief's dependencies, built the way app.ts builds them, for calling runBrief directly. */
let deps: BriefDeps;

const now = new Date();
const hoursAgo = (hours: number) => Math.floor(now.getTime() / 1000 - hours * 3600);

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
    anilist: { minIntervalMs: 0, retry: { retries: 1, baseDelayMs: 1, maxDelayMs: 5 } },
    models,
    roles: { agent: AGENT, escalation: null, brief: BRIEF },
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
    models,
    model: BRIEF,
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
  models.reset();

  // Two Watching shows: the fixture's (on ep 7 of 12) and a second one not started yet.
  const list = fixtureList();
  const second = structuredClone(list[0]);
  if (!second) throw new Error("fixture changed");
  second.node.id = 900007;
  second.node.title = "Fixture Second Show";
  second.node.alternative_titles = { synonyms: [], en: "", ja: "" };
  second.list_status.num_episodes_watched = 0;
  // MAL's start date lines AniList's parts up in the split-show test.
  second.node.start_date = "2026-03-19";
  h.fakeMal.list = [...list, second];

  anilist.media = [
    airingMedia(501, 900001, {
      externalLinks: [
        {
          siteId: 5,
          site: "Crunchyroll",
          url: "https://cr.example/501",
          type: "STREAMING",
          isDisabled: false,
        },
        {
          siteId: 10,
          site: "Netflix",
          url: "https://nf.example/501",
          type: "STREAMING",
          isDisabled: false,
        },
      ],
    }),
    airingMedia(502, 900007, {
      externalLinks: [
        {
          siteId: 10,
          site: "Netflix",
          url: "https://nf.example/502",
          type: "STREAMING",
          isDisabled: false,
        },
      ],
    }),
  ];
  anilist.airings = [
    { mediaId: 501, episode: 7, airingAt: hoursAgo(5) }, // already watched
    { mediaId: 502, episode: 1, airingAt: hoursAgo(3) },
    { mediaId: 501, episode: 8, airingAt: hoursAgo(2) },
    { mediaId: 501, episode: 9, airingAt: hoursAgo(1) },
    { mediaId: 777, episode: 4, airingAt: hoursAgo(1) }, // not on the list
  ];

  const result = await login(h);
  if (!result.sessionCookie) throw new Error("login failed");
  cookie = result.sessionCookie;
  await backgroundSettled(h);
  const [user] = await h.db.select({ id: users.id }).from(users);
  if (!user) throw new Error("no user");
  userId = user.id;

  browser = pushService.browser("laptop");
  expect((await send("POST", "/push/subscriptions", browser.subscription)).statusCode).toBe(200);
  const saved = await send("PUT", "/brief/settings", {
    enabled: true,
    time: "08:00",
    timeZone: "UTC",
    services: ["crunchyroll"],
  });
  expect(saved.statusCode).toBe(200);
});

function send(method: "GET" | "POST" | "PUT" | "DELETE", url: string, payload?: object) {
  return h.app.inject({
    method,
    url,
    headers: { origin: TEST_WEB_ORIGIN },
    cookies: { [SESSION_COOKIE]: cookie },
    ...(payload ? { payload: payload as Record<string, unknown> } : {}),
  });
}

/** The chat the latest brief went to. */
async function briefChat(): Promise<{ id: string; title: string | null }> {
  const [row] = await h.db
    .select({ id: conversations.id, title: conversations.title })
    .from(briefs)
    .innerJoin(chatMessages, eq(briefs.chatMessageId, chatMessages.id))
    .innerJoin(conversations, eq(chatMessages.conversationId, conversations.id))
    .orderBy(desc(briefs.createdAt))
    .limit(1);
  if (!row) throw new Error("no brief chat");
  return row;
}

/** Replies in the latest brief's chat. */
async function reply(text: string) {
  return send("POST", "/chat/messages", { text, conversationId: (await briefChat()).id });
}

async function briefMessages(): Promise<string[]> {
  const rows = await h.db
    .select({ content: chatMessages.content })
    .from(chatMessages)
    .where(eq(chatMessages.role, "assistant"));
  return rows.map((r) => r.content);
}

function decryptedPushes(): { title: string; body: string; url: string; tag: string }[] {
  return pushService.received.map(
    (p) =>
      JSON.parse(browser.decrypt(p.body)) as {
        title: string;
        body: string;
        url: string;
        tag: string;
      },
  );
}

describe("settings", () => {
  it("has defaults, saves, and rejects bad values", async () => {
    await h.db.delete(briefSettings);
    expect((await send("GET", "/brief/settings")).json()).toEqual({
      enabled: false,
      time: "08:00",
      timeZone: "UTC",
      services: [],
      sundayRecap: true,
      next: null,
      lastDaily: null,
    });

    const saved = await send("PUT", "/brief/settings", {
      enabled: true,
      time: "07:45",
      timeZone: "Asia/Tokyo",
      services: ["netflix", "crunchyroll", "netflix"],
    });
    expect(saved.json()).toMatchObject({
      enabled: true,
      time: "07:45",
      timeZone: "Asia/Tokyo",
      services: ["netflix", "crunchyroll"],
    });
    expect((await send("GET", "/brief/settings")).json()).toEqual(saved.json());

    for (const bad of [
      { enabled: true, time: "7:45", timeZone: "UTC", services: [] },
      { enabled: true, time: "24:00", timeZone: "UTC", services: [] },
      { enabled: true, time: "08:00", timeZone: "Mars/Base", services: [] },
      { enabled: true, time: "08:00", timeZone: "UTC", services: ["piratestream"] },
      { enabled: "yes", time: "08:00", timeZone: "UTC", services: [] },
    ]) {
      const res = await send("PUT", "/brief/settings", bad);
      expect(res.statusCode, JSON.stringify(bad)).toBe(400);
      expect(res.json()).toEqual({ error: "invalid_settings" });
    }
  });
});

describe("changing the brief time", () => {
  const todayUtc = () => new Date().toISOString().slice(0, 10);
  const settings = (time: string) => ({
    enabled: true,
    time,
    timeZone: "UTC",
    services: ["crunchyroll"],
  });

  it("applies today when today's brief sent nothing", async () => {
    for (const [status, time] of [
      ["empty", "09:00"],
      ["skipped_late", "10:00"],
    ] as const) {
      await h.db.insert(briefs).values({ userId, kind: "daily", localDate: todayUtc(), status });
      await send("PUT", "/brief/settings", settings(time));
      expect(await h.db.select().from(briefs), status).toEqual([]);
    }
  });

  it("waits for tomorrow when today's brief went out, or the time didn't change", async () => {
    await h.db
      .insert(briefs)
      .values({ userId, kind: "daily", localDate: todayUtc(), status: "sent" });
    await send("PUT", "/brief/settings", settings("09:00"));
    expect(await h.db.select().from(briefs)).toHaveLength(1);

    await h.db.update(briefs).set({ status: "empty" });
    await send("PUT", "/brief/settings", { ...settings("09:00"), services: ["netflix"] });
    expect(await h.db.select().from(briefs)).toHaveLength(1);
  });

  it("says when the next brief goes out and how the last one went", async () => {
    const on = { enabled: true, localTime: "08:00", timeZone: "UTC" };
    const at = (iso: string) => new Date(iso);

    expect(await briefSchedule(h.db, userId, on, at("2026-10-06T07:00:00Z"))).toEqual({
      next: "today",
      lastDaily: null,
    });
    // Due now: it goes out at the next tick.
    expect((await briefSchedule(h.db, userId, on, at("2026-10-06T08:02:00Z"))).next).toBe("today");
    // Too late for today.
    expect((await briefSchedule(h.db, userId, on, at("2026-10-06T13:00:00Z"))).next).toBe(
      "tomorrow",
    );
    const off = { ...on, enabled: false };
    expect((await briefSchedule(h.db, userId, off, at("2026-10-06T07:00:00Z"))).next).toBeNull();

    await h.db.insert(briefs).values({
      userId,
      kind: "daily",
      localDate: "2026-10-06",
      status: "sent",
      items: [
        {
          malId: 1,
          title: "A",
          episodes: [3, 4],
          premiere: false,
          finale: false,
          episodesWatched: 2,
          services: [],
        },
      ],
    });
    expect(await briefSchedule(h.db, userId, on, at("2026-10-06T08:10:00Z"))).toMatchObject({
      next: "tomorrow",
      lastDaily: { localDate: "2026-10-06", status: "sent", episodes: 2 },
    });
  });

  it("returns the schedule from the settings routes", async () => {
    const view = (await send("GET", "/brief/settings")).json<{ next: string | null }>();
    expect(view).toMatchObject({ enabled: true, time: "08:00", lastDaily: null });
    expect(["today", "tomorrow"]).toContain(view.next);
  });
});

describe("POST /brief/test", () => {
  it("sends new episodes as a notification and a chat message", async () => {
    models.script(BRIEF.ref, [
      { text: "Fixture Watching Show has two new episodes, plus a premiere." },
    ]);

    const res = await send("POST", "/brief/test");

    expect(res.json()).toEqual({
      status: "sent",
      episodes: 3,
      started: 0,
      recap: false,
      push: { sent: 1, removed: 0, failed: 0 },
    });
    // The brief starts its own chat, which tapping the notification opens.
    const chat = await briefChat();
    expect(chat.title).toMatch(/^Brief, [A-Z][a-z]{2} \d{1,2}$/);
    expect(decryptedPushes()).toEqual([
      {
        title: "3 new episodes",
        body: "Fixture Second Show 1 (premiere) · Fixture Watching Show 8–9",
        url: `/chat/${chat.id}`,
        tag: "brief",
      },
    ]);
    expect(await briefMessages()).toEqual([
      [
        "Fixture Watching Show has two new episodes, plus a premiere.",
        "",
        // Netflix isn't one of the user's services, so the second show says nothing about where.
        "- Fixture Second Show ep 1 (premiere)",
        "- Fixture Watching Show eps 8–9 on Crunchyroll",
        "",
        `Reply "watched it" once you've caught up on all of these.`,
      ].join("\n"),
    ]);
    const [row] = await h.db.select().from(briefs);
    expect(row).toMatchObject({
      kind: "test",
      status: "sent",
      summarySource: "model",
      model: BRIEF.ref,
      promptVersion: "brief-summary@1",
      inputTokens: 100,
      outputTokens: 10,
      pushSent: 1,
      error: null,
    });
  });

  it("sends nothing when nothing new aired", async () => {
    anilist.airings = [];

    expect((await send("POST", "/brief/test")).json()).toEqual({
      status: "empty",
      episodes: 0,
      started: 0,
      recap: false,
      push: { sent: 0, removed: 0, failed: 0 },
    });
    expect(pushService.received).toHaveLength(0);
    expect(await briefMessages()).toEqual([]);
    expect(models.requests).toHaveLength(0);
  });

  it("uses the template when the model's line has a number that isn't in the brief", async () => {
    models.script(BRIEF.ref, [{ text: "Episode 10 of Fixture Watching Show is out." }]);

    await send("POST", "/brief/test");

    const [message] = await briefMessages();
    expect(message?.split("\n")[0]).toBe("3 new episodes from 2 shows you're watching.");
    const [row] = await h.db.select().from(briefs);
    expect(row?.summarySource).toBe("template");
  });

  it("reports AniList being down, and is limited to once a minute", async () => {
    anilist.failNext(503, 2);

    const res = await send("POST", "/brief/test");
    expect(res.statusCode).toBe(502);
    expect(res.json()).toEqual({ error: "anilist_unavailable" });
    const [row] = await h.db.select().from(briefs);
    expect(row).toMatchObject({ status: "failed", error: "anilist_unavailable" });

    const again = await send("POST", "/brief/test");
    expect(again.statusCode).toBe(429);
    expect(again.json()).toEqual({ error: "too_soon" });
  });

  it('puts the brief in the agent\'s history, so a reply like "watched it" has context', async () => {
    models.script(BRIEF.ref, [{ text: "New episodes are out." }]);
    await send("POST", "/brief/test");
    models.script(AGENT.ref, [{ text: "Which show did you watch?" }]);

    await reply("watched it");

    const agentCall = models.requests.find((r) => r.ref === AGENT.ref);
    const history = agentCall?.request.messages.map((m) => m.content).join("\n") ?? "";
    expect(history).toContain("- Fixture Watching Show eps 8–9 on Crunchyroll");
    expect(history).toContain("watched it");
  });
});

describe('replying "watched it" to a brief', () => {
  const WATCHING = 900001; // on ep 7; the brief lists eps 8–9
  const SECOND = 900007; // on ep 0; the brief lists ep 1 (premiere)
  const PAUSED = 900003; // not in the brief

  /** The agent searches both shows, then proposes and commits the given changes. */
  function replyScript(changes: { anime_id: number; episodes_watched: number }[]) {
    const steps: ScriptStep[] = [
      {
        toolCalls: [
          {
            name: "search_my_list",
            arguments: {
              queries: ["Fixture Watching Show", "Fixture Second Show", "Fixture Paused Show"],
            },
          },
        ],
      },
      { toolCalls: changes.map((change) => ({ name: "propose_update", arguments: change })) },
      (req) => {
        const proposals = req.messages
          .filter((m): m is Extract<LlmMessage, { role: "tool" }> => m.role === "tool")
          .slice(-changes.length)
          .map(
            (m) => JSON.parse(m.content) as { proposal_id: string; requires_confirmation: boolean },
          )
          .filter((p) => !p.requires_confirmation);
        return {
          toolCalls: proposals.map((p) => ({
            name: "commit_update",
            arguments: { proposal_id: p.proposal_id },
          })),
        };
      },
      { text: "Done." },
    ];
    return steps;
  }

  async function sendBrief() {
    models.script(BRIEF.ref, [{ text: "New episodes are out." }]);
    await send("POST", "/brief/test");
    h.fakeMal.patchRequests.length = 0;
  }

  async function heldReasons(): Promise<Record<number, string | null>> {
    const rows = await h.db
      .select({ animeId: proposals.animeId, reason: proposals.confirmationReason })
      .from(proposals)
      .where(eq(proposals.status, "pending"));
    return Object.fromEntries(rows.map((r) => [r.animeId, r.reason]));
  }

  it("writes every show up to the last episode the brief listed", async () => {
    await sendBrief();
    models.script(
      AGENT.ref,
      replyScript([
        { anime_id: WATCHING, episodes_watched: 9 },
        { anime_id: SECOND, episodes_watched: 1 },
      ]),
    );

    await reply("watched it");

    expect(h.fakeMal.patchRequests.map((p) => [p.animeId, p.form.num_watched_episodes])).toEqual([
      [WATCHING, "9"],
      [SECOND, "1"],
    ]);
  });

  it("holds any other episode, and shows the brief didn't list", async () => {
    await sendBrief();
    models.script(
      AGENT.ref,
      replyScript([
        { anime_id: WATCHING, episodes_watched: 8 },
        { anime_id: SECOND, episodes_watched: 1 },
        { anime_id: PAUSED, episodes_watched: 11 },
      ]),
    );

    await reply("watched them all");

    expect(h.fakeMal.patchRequests.map((p) => p.animeId)).toEqual([SECOND]);
    // Neither the reply nor the brief names the paused show, so the model's title for it isn't
    // the user's words: it's held as unclear before the brief's rules come into it.
    expect(await heldReasons()).toEqual({
      [WATCHING]: "not_in_brief",
      [PAUSED]: "ambiguous_match",
    });
  });

  it("writes a named episode only for the show the brief listed it for", async () => {
    await sendBrief();
    models.script(
      AGENT.ref,
      replyScript([
        { anime_id: WATCHING, episodes_watched: 9 },
        { anime_id: SECOND, episodes_watched: 9 },
      ]),
    );

    await reply("watched ep 9");

    expect(h.fakeMal.patchRequests.map((p) => p.animeId)).toEqual([WATCHING]);
    expect(await heldReasons()).toEqual({ [SECOND]: "not_in_brief" });
  });

  it("caps a count at the last episode the brief listed", async () => {
    await sendBrief();
    models.script(
      AGENT.ref,
      replyScript([
        { anime_id: WATCHING, episodes_watched: 8 },
        { anime_id: SECOND, episodes_watched: 2 },
      ]),
    );

    await reply("watched one ep of each");

    expect(h.fakeMal.patchRequests.map((p) => p.animeId)).toEqual([WATCHING]);
    expect(await heldReasons()).toEqual({ [SECOND]: "not_in_brief" });
  });

  it("writes nothing when the reply says they haven't watched", async () => {
    await sendBrief();
    models.script(AGENT.ref, replyScript([{ anime_id: WATCHING, episodes_watched: 9 }]));

    await reply("havent seen them yet");

    expect(h.fakeMal.patchRequests).toEqual([]);
    expect(await heldReasons()).toEqual({ [WATCHING]: "not_in_brief" });
  });

  it("only writes the shows a reply names, whichever ones the model picks", async () => {
    await sendBrief();
    // "FWS" is a nickname of the watching show; the model wrongly adds the second show too.
    models.script(
      AGENT.ref,
      replyScript([
        { anime_id: WATCHING, episodes_watched: 9 },
        { anime_id: SECOND, episodes_watched: 1 },
      ]),
    );

    await reply("watched fws");

    expect(h.fakeMal.patchRequests.map((p) => p.animeId)).toEqual([WATCHING]);
    expect(await heldReasons()).toEqual({ [SECOND]: "not_named" });
  });

  it("doesn't apply in another chat", async () => {
    await sendBrief();
    models.script(AGENT.ref, [{ text: "Which show did you watch?" }]);

    await send("POST", "/chat/messages", { text: "watched it" });

    const agentCall = models.requests.find((r) => r.ref === AGENT.ref);
    expect(agentCall?.request.messages.map((m) => m.content)).toEqual(["watched it"]);
  });

  it("only applies right after the brief", async () => {
    await sendBrief();
    models.script(AGENT.ref, [{ text: "Hi!" }]);
    await reply("hello");
    models.script(AGENT.ref, replyScript([{ anime_id: WATCHING, episodes_watched: 8 }]));

    // Right after the brief this would mean caught up (ep 9); now it's just the next episode.
    await reply("watched fixture watching show");

    expect(h.fakeMal.patchRequests.map((p) => p.animeId)).toEqual([WATCHING]);
  });
});

describe("daily briefs", () => {
  const today = () => now.toISOString().slice(0, 10);

  it("sends once per day, however often it runs", async () => {
    models.script(BRIEF.ref, [{ text: "New episodes are out." }]);

    expect(await runBrief(deps, userId, { kind: "daily", localDate: today() }, now)).toMatchObject({
      status: "sent",
      episodes: 3,
    });
    expect(await runBrief(deps, userId, { kind: "daily", localDate: today() }, now)).toMatchObject({
      status: "skipped",
    });

    expect(pushService.received).toHaveLength(1);
    expect(await briefMessages()).toHaveLength(1);
  });

  it("starts where the last brief ended", async () => {
    models.script(BRIEF.ref, [{ text: "First." }, { text: "Second." }]);
    const dayOne = new Date(now.getTime() - 24 * 3600_000);
    anilist.airings = [
      { mediaId: 501, episode: 8, airingAt: hoursAgo(30) }, // before day one: in day one's brief
      { mediaId: 501, episode: 9, airingAt: hoursAgo(2) }, // after day one: in day two's brief
    ];

    const first = await runBrief(deps, userId, { kind: "daily", localDate: "day-1" }, dayOne);
    const second = await runBrief(deps, userId, { kind: "daily", localDate: "day-2" }, now);

    expect([first.episodes, second.episodes]).toEqual([1, 1]);
    const titles = decryptedPushes().map((p) => p.title);
    expect(titles).toEqual(["Fixture Watching Show ep 8", "Fixture Watching Show ep 9"]);
  });

  it("retries a failed push without posting the chat message twice", async () => {
    models.script(BRIEF.ref, [{ text: "New episodes are out." }]);
    pushService.respond("/push/laptop", 500);

    await expect(
      runBrief(deps, userId, { kind: "daily", localDate: today() }, now),
    ).rejects.toBeInstanceOf(BriefPushError);
    const [failed] = await h.db.select().from(briefs);
    expect(failed).toMatchObject({ status: "ready", error: "push_failed" });
    expect(failed?.chatMessageId).not.toBeNull();

    pushService.respond("/push/laptop", 201);
    expect(await runBrief(deps, userId, { kind: "daily", localDate: today() }, now)).toMatchObject({
      status: "sent",
      push: { sent: 1 },
    });
    expect(await briefMessages()).toHaveLength(1);
    expect(models.requests).toHaveLength(1);
    const [sent] = await h.db.select().from(briefs);
    expect(sent).toMatchObject({ status: "sent", error: null });
  });

  it("records an empty day and sends nothing", async () => {
    anilist.airings = [];
    expect(await runBrief(deps, userId, { kind: "daily", localDate: today() }, now)).toMatchObject({
      status: "empty",
    });
    expect(pushService.received).toHaveLength(0);
    const [row] = await h.db.select().from(briefs);
    expect(row?.status).toBe("empty");
  });
});

describe("shows that started airing", () => {
  const today = () => now.toISOString().slice(0, 10);
  const PLANNED = 900005; // the fixture's Plan to Watch show, not aired yet on MAL
  const FINISHED = 900006; // completed (and being rewatched)
  const SEQUEL = 800300; // its sequel, not on the list
  const PAUSED = 900003; // on hold, so already on the list

  beforeEach(async () => {
    // The Plan to Watch show premiered on AniList, and so did a sequel of a finished show.
    anilist.media.push(airingMedia(505, PLANNED));
    anilist.relations.set(FINISHED, [
      relatedShow("SEQUEL", 7300, SEQUEL, "Fixture Rewatch Show 2", {
        externalLinks: [streamingLink(5, "Crunchyroll", "https://cr.example/7300")],
      }),
      // Not news: a movie has no first episode to air, and a show they have is on the list.
      relatedShow("SEQUEL", 7301, 800301, "Fixture Rewatch Movie", { format: "MOVIE" }),
      relatedShow("SEQUEL", 7302, PAUSED, "Fixture Paused Show"),
      relatedShow("SIDE_STORY", 7303, 800303, "Fixture Rewatch OVA"),
    ]);
    // Login cached AniList's earlier answers; the brief asks again.
    await h.db.delete(anilistMedia).where(eq(anilistMedia.malId, PLANNED));
    await h.db.delete(anilistSequels);
    anilist.airings = [
      { mediaId: 505, episode: 1, airingAt: hoursAgo(6) },
      { mediaId: 7300, episode: 1, airingAt: hoursAgo(4) },
      { mediaId: 7300, episode: 2, airingAt: hoursAgo(3) },
      { mediaId: 7301, episode: 1, airingAt: hoursAgo(3) },
      { mediaId: 7302, episode: 1, airingAt: hoursAgo(3) },
      { mediaId: 7303, episode: 1, airingAt: hoursAgo(3) },
    ];
  });

  it("sends a brief of premieres alone, with a card for each, and no model call", async () => {
    const res = await send("POST", "/brief/test");

    expect(res.json()).toEqual({
      status: "sent",
      episodes: 0,
      started: 2,
      recap: false,
      push: { sent: 1, removed: 0, failed: 0 },
    });
    expect(models.requests).toHaveLength(0);
    expect(decryptedPushes()).toEqual([
      expect.objectContaining({
        title: "2 shows started airing",
        body: "Fixture Unannounced Sequel · Fixture Rewatch Show 2",
      }),
    ]);
    expect(await briefMessages()).toEqual([
      [
        "2 shows you follow started airing.",
        "",
        "- Fixture Unannounced Sequel. It's on your Plan to Watch. On Crunchyroll.",
        "- Fixture Rewatch Show 2. You finished Fixture Rewatch Show. On Crunchyroll.",
      ].join("\n"),
    ]);

    // The sequel has a row to show it by, and to add it from; its card says it's not on the list.
    const [row] = await h.db.select().from(anime).where(eq(anime.malId, SEQUEL));
    expect(row?.title).toBe("Fixture Rewatch Show 2");
    const thread = (await send("GET", `/chat/conversations/${(await briefChat()).id}`)).json<{
      messages: { shows: { animeId: number; status: string | null }[]; asksToChoose: boolean }[];
    }>();
    expect(thread.messages[0]?.shows.map((show) => [show.animeId, show.status])).toEqual([
      [PLANNED, "plan_to_watch"],
      [SEQUEL, null],
    ]);
    expect(thread.messages[0]?.asksToChoose).toBe(false);
  });

  it("lists them after new episodes, and says each one once", async () => {
    models.script(BRIEF.ref, [{ text: "Fixture Watching Show has a new episode." }]);
    anilist.airings.push({ mediaId: 501, episode: 8, airingAt: hoursAgo(2) });
    const dayOne = new Date(now.getTime() - 24 * 3600_000);
    const dayThree = new Date(now.getTime() + 24 * 3600_000);

    const runs = [
      await runBrief(deps, userId, { kind: "daily", localDate: "day-1" }, dayOne),
      await runBrief(deps, userId, { kind: "daily", localDate: today() }, now),
      await runBrief(deps, userId, { kind: "daily", localDate: "day-3" }, dayThree),
    ];

    // Everything aired between day one and today: it's all in today's brief, and only there.
    expect(runs.map((r) => [r.status, r.episodes, r.alerts])).toEqual([
      ["empty", 0, 0],
      ["sent", 1, 2],
      ["empty", 0, 0],
    ]);
    expect(await briefMessages()).toEqual([
      [
        "Fixture Watching Show has a new episode.",
        "",
        "- Fixture Watching Show ep 8 on Crunchyroll",
        "",
        `Reply "watched it" once you've caught up on all of these.`,
        "",
        "Started airing:",
        "- Fixture Unannounced Sequel. It's on your Plan to Watch. On Crunchyroll.",
        "- Fixture Rewatch Show 2. You finished Fixture Rewatch Show. On Crunchyroll.",
      ].join("\n"),
    ]);
    expect(decryptedPushes().map((p) => [p.title, p.body])).toEqual([
      [
        "Fixture Watching Show ep 8",
        "On Crunchyroll. Started airing: Fixture Unannounced Sequel, Fixture Rewatch Show 2. Tap to open the chat.",
      ],
    ]);
    const [sent] = await h.db.select().from(briefs).where(eq(briefs.status, "sent"));
    expect(sent?.alerts.map((a) => [a.malId, a.kind])).toEqual([
      [PLANNED, "ptw_started"],
      [SEQUEL, "sequel_started"],
    ]);
  });

  it("still sends the episodes when AniList can't say what follows a show", async () => {
    models.script(BRIEF.ref, [{ text: "Fixture Watching Show has a new episode." }]);
    anilist.relations = new Map();
    anilist.airings = [{ mediaId: 501, episode: 8, airingAt: hoursAgo(2) }];
    // The sequels request fails; the rest go through.
    anilist.failNext(503, 2);

    const outcome = await runBrief(deps, userId, { kind: "daily", localDate: today() }, now);

    expect([outcome.status, outcome.episodes, outcome.alerts]).toEqual(["sent", 1, 0]);
  });
});

describe("the Sunday recap", () => {
  const SUNDAY = "2026-10-11";
  const MONDAY = "2026-10-12";

  // These briefs run at the current time, after the edit below (the file's `now` is earlier).
  beforeEach(async () => {
    // Nothing new aired; the week had two episodes logged, and there's a goal.
    anilist.airings = [];
    const edit = await send("POST", "/list/900001/edit", {
      episodesWatched: 9,
      requestId: crypto.randomUUID(),
    });
    expect(edit.statusCode).toBe(200);
    expect((await send("PUT", "/stats/goal", { target: 10 })).statusCode).toBe(200);
  });

  it("sums up the week on a Sunday, alone, with no model call", async () => {
    const outcome = await runBrief(deps, userId, { kind: "daily", localDate: SUNDAY }, new Date());

    expect(outcome).toMatchObject({ status: "sent", episodes: 0, alerts: 0, recap: true });
    expect(models.requests).toHaveLength(0);
    const [message] = await briefMessages();
    expect(message).toMatch(
      /^This week: 2 episodes \(0\.8 hours\) across 1 show\. \d{4} goal: \d+ of 10 shows\.$/,
    );
    expect(decryptedPushes()).toEqual([
      expect.objectContaining({ title: "Your week: 2 episodes" }),
    ]);
    const [row] = await h.db.select().from(briefs);
    expect(row?.recap).toMatchObject({ episodes: 2, minutes: 48, shows: 1, goal: 10 });
  });

  it("closes a Sunday brief that has new episodes", async () => {
    models.script(BRIEF.ref, [{ text: "Fixture Watching Show has a new episode." }]);
    anilist.airings = [{ mediaId: 501, episode: 10, airingAt: hoursAgo(2) }];

    await runBrief(deps, userId, { kind: "daily", localDate: SUNDAY }, new Date());

    const lines = (await briefMessages())[0]?.split("\n") ?? [];
    expect(lines.slice(0, 5)).toEqual([
      "Fixture Watching Show has a new episode.",
      "",
      "- Fixture Watching Show ep 10 on Crunchyroll",
      "",
      `Reply "watched it" once you've caught up on all of these.`,
    ]);
    expect(lines.at(-1)).toMatch(/^This week: 2 episodes/);
    // The notification is about the new episode.
    expect(decryptedPushes()[0]?.title).toBe("Fixture Watching Show ep 10");
  });

  it("isn't sent on other days, or when it's turned off", async () => {
    expect(
      (await runBrief(deps, userId, { kind: "daily", localDate: MONDAY }, new Date())).status,
    ).toBe("empty");

    const off = await send("PUT", "/brief/settings", {
      enabled: true,
      time: "08:00",
      timeZone: "UTC",
      services: ["crunchyroll"],
      sundayRecap: false,
    });
    expect(off.json()).toMatchObject({ sundayRecap: false });
    expect(
      (await runBrief(deps, userId, { kind: "daily", localDate: SUNDAY }, new Date())).status,
    ).toBe("empty");
    expect(pushService.received).toHaveLength(0);

    // A page that doesn't send the setting leaves it as it was.
    const kept = await send("PUT", "/brief/settings", {
      enabled: true,
      time: "08:00",
      timeZone: "UTC",
      services: ["crunchyroll"],
    });
    expect(kept.json()).toMatchObject({ sundayRecap: false });
  });
});

describe("airing data", () => {
  it("is refreshed in the background after a list sync, for Watching, airing and pickable shows", async () => {
    // beforeEach logged in, which synced the list.
    const deadline = Date.now() + 5_000;
    let ids: number[] = [];
    while (Date.now() < deadline) {
      ids = (await h.db.select({ malId: anilistMedia.malId }).from(anilistMedia)).map(
        (r) => r.malId,
      );
      if (ids.length >= 5) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    // Both Watching shows and the Plan to Watch sequel MAL says hasn't aired yet (airing data),
    // plus the On hold and rewatching shows the recommender can pick (where to watch). Not the
    // completed film or the dropped show.
    expect(ids.sort()).toEqual([900001, 900003, 900005, 900006, 900007]);
  });
});

describe("split shows", () => {
  it("lists a split show's episodes in MAL's numbering", async () => {
    // Let the background refresh from login finish, then start from an empty cache.
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline && (await h.db.select().from(anilistMedia)).length < 5) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    await h.db.delete(anilistMedia);

    // AniList splits the second show: a finished 1-episode first part, then a second part
    // numbered from 1 again. MAL counts straight through, so its ep 1 is MAL's ep 2.
    anilist.media = anilist.media.filter((m) => m.idMal !== 900007);
    anilist.media.push(
      airingMedia(601, 900007, {
        format: "ONA",
        status: "FINISHED",
        episodes: 1,
        startDate: { year: 2026, month: 3, day: 19 },
      }),
      // MAL says 12 episodes in all: 1 + 11, and MAL's start date is the first part's.
      airingMedia(602, 900007, {
        format: "ONA",
        episodes: 11,
        startDate: { year: 2026, month: 9, day: 25 },
      }),
    );
    anilist.airings = [{ mediaId: 602, episode: 1, airingAt: hoursAgo(3) }];
    models.script(BRIEF.ref, [{ text: "New episodes are out." }]);

    await send("POST", "/brief/test");

    expect(decryptedPushes().map((push) => push.title)).toEqual(["Fixture Second Show ep 2"]);
  });
});

describe("dueBriefs", () => {
  const at = (iso: string) => new Date(iso);

  it("finds users whose brief time has passed today, once", async () => {
    expect(await dueBriefs(h.db, at("2026-10-06T07:59:00Z"))).toEqual([]);
    expect(await dueBriefs(h.db, at("2026-10-06T08:03:00Z"))).toEqual([
      { userId, localDate: "2026-10-06" },
    ]);

    await h.db
      .insert(briefs)
      .values({ userId, kind: "daily", localDate: "2026-10-06", status: "sent" });
    expect(await dueBriefs(h.db, at("2026-10-06T08:08:00Z"))).toEqual([]);
    // A test brief doesn't use up the day.
    await h.db.delete(briefs);
    await h.db.insert(briefs).values({ userId, kind: "test", status: "sent" });
    expect(await dueBriefs(h.db, at("2026-10-06T08:08:00Z"))).toHaveLength(1);
  });

  it("uses the user's time zone", async () => {
    await h.db.update(briefSettings).set({ timeZone: "Asia/Tokyo" });
    // 08:03 in Tokyo is 23:03 UTC the day before.
    expect(await dueBriefs(h.db, at("2026-10-05T23:03:00Z"))).toEqual([
      { userId, localDate: "2026-10-06" },
    ]);
  });

  it("skips the day when the brief time passed more than four hours ago", async () => {
    expect(await dueBriefs(h.db, at("2026-10-06T12:30:00Z"))).toEqual([]);
    const [row] = await h.db.select().from(briefs);
    expect(row).toMatchObject({ kind: "daily", localDate: "2026-10-06", status: "skipped_late" });
  });

  it("skips users with the brief off or no device to send to", async () => {
    await h.db.update(briefSettings).set({ enabled: false });
    expect(await dueBriefs(h.db, at("2026-10-06T08:03:00Z"))).toEqual([]);

    await h.db.update(briefSettings).set({ enabled: true });
    await h.db.delete(pushSubscriptions);
    expect(await dueBriefs(h.db, at("2026-10-06T08:03:00Z"))).toEqual([]);
  });
});

describe("the queue", () => {
  it("runs a queued brief job through pg-boss", async () => {
    models.script(BRIEF.ref, [{ text: "New episodes are out." }]);
    const databaseUrl = inject("databaseUrl");
    const scheduler = createBriefScheduler({ ...deps, databaseUrl });
    await scheduler.start();
    const client = new PgBoss({ connectionString: databaseUrl, schema: "pgboss" });
    await client.start();
    try {
      const localDate = today();
      await client.send("brief", { userId, localDate }, { singletonKey: `${userId}:${localDate}` });

      const deadline = Date.now() + 20_000;
      let status: string | undefined;
      while (Date.now() < deadline) {
        const [row] = await h.db
          .select({ status: briefs.status })
          .from(briefs)
          .where(and(eq(briefs.userId, userId), eq(briefs.localDate, localDate)));
        status = row?.status;
        if (status === "sent") break;
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      expect(status).toBe("sent");
      expect(pushService.received).toHaveLength(1);
    } finally {
      await client.stop({ graceful: false });
      await scheduler.stop();
    }
  }, 40_000);

  function today() {
    return now.toISOString().slice(0, 10);
  }
});
