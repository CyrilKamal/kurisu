import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { SESSION_COOKIE } from "../../src/auth/sessions.js";
import { anime, listEntries, syncRuns, users } from "../../src/db/schema.js";
import { fixtureList } from "../fixtures/animeList.js";
import { login, resetDatabase, startHarness, type Harness } from "../support/harness.js";
import { TEST_WEB_ORIGIN } from "../support/testConfig.js";

let h: Harness;

beforeAll(async () => {
  h = await startHarness();
});

afterAll(async () => {
  await h.close();
});

beforeEach(async () => {
  await resetDatabase(h.db);
  h.fakeMal.reset();
  h.fakeMal.list = fixtureList();
});

interface ListResponse {
  entries: {
    animeId: number;
    title: string;
    pictureUrl: string | null;
    mediaType: string | null;
    numEpisodes: number | null;
    airingStatus: string | null;
    status: string;
    score: number;
    episodesWatched: number;
    isRewatching: boolean;
    updatedAt: string;
  }[];
  lastSync: { status: string; trigger: string; entriesCount: number | null; error: string | null };
}

async function loginOk(): Promise<string> {
  const result = await login(h);
  expect(result.callbackResponse.headers.location).toBe("/list");
  if (!result.sessionCookie) throw new Error("expected a session cookie");
  return result.sessionCookie;
}

async function getList(cookie: string): Promise<ListResponse> {
  const res = await h.app.inject({
    method: "GET",
    url: "/list",
    cookies: { [SESSION_COOKIE]: cookie },
  });
  expect(res.statusCode).toBe(200);
  return res.json<ListResponse>();
}

function postSync(cookie: string) {
  return h.app.inject({
    method: "POST",
    url: "/sync",
    headers: { origin: TEST_WEB_ORIGIN },
    cookies: { [SESSION_COOKIE]: cookie },
  });
}

/** Moves the user's sync history back in time, past the manual-sync cooldown. */
async function skipCooldown(): Promise<void> {
  await h.db.update(syncRuns).set({ startedAt: new Date(Date.now() - 61_000) });
}

describe("sync on login", () => {
  it("mirrors the whole list, following MAL's paging", async () => {
    h.fakeMal.pageSize = 2; // 6 entries -> 3 pages

    const cookie = await loginOk();

    expect(h.fakeMal.animeListRequests).toHaveLength(3);
    const first = h.fakeMal.animeListRequests[0];
    expect(first?.searchParams.get("nsfw")).toBe("true");
    expect(first?.searchParams.get("limit")).toBe("1000");
    expect(first?.searchParams.get("fields")).toContain("list_status");

    const list = await getList(cookie);
    expect(list.entries).toHaveLength(6);
    expect(list.lastSync).toMatchObject({
      status: "succeeded",
      trigger: "login",
      entriesCount: 6,
      error: null,
    });
  });

  it("stores MAL's fields faithfully, newest update first", async () => {
    const cookie = await loginOk();

    const list = await getList(cookie);
    expect(list.entries.map((e) => e.animeId)).toEqual([
      900001, 900006, 900002, 900003, 900004, 900005,
    ]);

    const watching = list.entries.find((e) => e.animeId === 900001);
    expect(watching).toEqual({
      animeId: 900001,
      title: "Fixture Watching Show",
      pictureUrl: "https://cdn.myanimelist.net/images/anime/0/900001.jpg",
      mediaType: "tv",
      numEpisodes: 12,
      airingStatus: "finished_airing",
      status: "watching",
      score: 0,
      episodesWatched: 7,
      isRewatching: false,
      updatedAt: "2026-09-28T10:00:00.000Z",
    });

    // Unknown episode count (MAL's 0) and a missing picture come through as null.
    const sequel = list.entries.find((e) => e.animeId === 900005);
    expect(sequel).toMatchObject({ numEpisodes: null, pictureUrl: null, status: "plan_to_watch" });
    expect(list.entries.find((e) => e.animeId === 900006)?.isRewatching).toBe(true);

    // Partial dates are kept as MAL sent them.
    const [film] = await h.db.select().from(listEntries).where(eq(listEntries.animeId, 900002));
    expect(film).toMatchObject({ startDate: "2026-08", finishDate: "2026-08-15", score: 9 });

    // Alternative titles are mirrored for nickname matching.
    const [show] = await h.db.select().from(anime).where(eq(anime.malId, 900001));
    expect(show).toMatchObject({ titleEn: "The Watching Show", titleJa: null, synonyms: ["FWS"] });
    const request = h.fakeMal.animeListRequests[0];
    expect(request?.searchParams.get("fields")).toContain("alternative_titles");
  });

  it("a failed sync doesn't fail the login", async () => {
    h.fakeMal.animeListFailures = [503, 503, 503, 503]; // first attempt + 3 retries

    const result = await login(h);

    expect(result.callbackResponse.headers.location).toBe("/list");
    const list = await getList(result.sessionCookie ?? "");
    expect(list.entries).toEqual([]);
    expect(list.lastSync).toMatchObject({ status: "failed", error: "mal_unavailable" });
  });
});

describe("POST /sync", () => {
  it("re-syncs: picks up progress changes, additions and removals made on MAL", async () => {
    const cookie = await loginOk();
    await skipCooldown();

    const changed = fixtureList().filter((i) => i.node.id !== 900004); // removed on MAL
    const watching = changed.find((i) => i.node.id === 900001);
    if (!watching) throw new Error("fixture missing");
    watching.list_status.num_episodes_watched = 8;
    watching.list_status.updated_at = "2026-09-29T09:00:00+00:00";
    changed.push({
      node: {
        id: 900007,
        title: "Fixture New Show",
        media_type: "ona",
        num_episodes: 10,
        status: "currently_airing",
      },
      list_status: {
        status: "watching",
        score: 0,
        num_episodes_watched: 1,
        is_rewatching: false,
        updated_at: "2026-09-29T10:00:00+00:00",
      },
    });
    h.fakeMal.list = changed;

    const res = await postSync(cookie);

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      lastSync: { status: "succeeded", trigger: "manual", entriesCount: 6 },
    });
    const list = await getList(cookie);
    const ids = list.entries.map((e) => e.animeId);
    expect(ids).not.toContain(900004);
    expect(ids[0]).toBe(900007);
    expect(list.entries.find((e) => e.animeId === 900001)?.episodesWatched).toBe(8);
    // Anime metadata stays for other users; only this user's entry is gone.
    expect(await h.db.select().from(anime).where(eq(anime.malId, 900004))).toHaveLength(1);
  });

  it("empties the mirror when the MAL list is empty", async () => {
    const cookie = await loginOk();
    await skipCooldown();
    h.fakeMal.list = [];

    const res = await postSync(cookie);

    expect(res.statusCode).toBe(200);
    expect((await getList(cookie)).entries).toEqual([]);
  });

  it("enforces a cooldown between syncs", async () => {
    const cookie = await loginOk(); // the login sync just ran
    const requestsBefore = h.fakeMal.animeListRequests.length;

    const res = await postSync(cookie);

    expect(res.statusCode).toBe(429);
    const body = res.json<{ error: string; retryAfterSeconds: number }>();
    expect(body.error).toBe("cooldown");
    expect(body.retryAfterSeconds).toBeGreaterThan(0);
    expect(body.retryAfterSeconds).toBeLessThanOrEqual(60);
    expect(res.headers["retry-after"]).toBe(String(body.retryAfterSeconds));
    expect(h.fakeMal.animeListRequests).toHaveLength(requestsBefore);
  });

  it("retries MAL's 429 and 5xx responses before giving up", async () => {
    const cookie = await loginOk();
    await skipCooldown();
    h.fakeMal.animeListFailures = [429, 503, 502];

    const res = await postSync(cookie);

    expect(res.statusCode).toBe(200);
    expect((await getList(cookie)).entries).toHaveLength(6);
  });

  it("keeps the previous mirror when MAL stays down, and reports the failure", async () => {
    const cookie = await loginOk();
    await skipCooldown();
    // MAL now has only 2 entries, but goes down after serving page 1. Applying page 1 alone
    // would wrongly delete 4 entries, so nothing may be applied at all.
    h.fakeMal.pageSize = 2;
    h.fakeMal.list = fixtureList().slice(0, 4);
    h.fakeMal.unavailableFromOffset = 2;
    const requestsBefore = h.fakeMal.animeListRequests.length;

    const res = await postSync(cookie);

    // Page 1 once, then page 2 on the first attempt plus every retry.
    expect(h.fakeMal.animeListRequests.length - requestsBefore).toBe(1 + 4);
    expect(res.statusCode).toBe(502);
    expect(res.json()).toMatchObject({
      error: "sync_failed",
      lastSync: { status: "failed", error: "mal_unavailable", trigger: "manual" },
    });
    // The login sync's 6 entries are still there, untouched.
    expect((await getList(cookie)).entries).toHaveLength(6);
  });

  it("refreshes the token and retries once when MAL rejects it", async () => {
    const cookie = await loginOk();
    await skipCooldown();
    h.fakeMal.invalidateAccessTokens(); // DB still thinks the token is valid for weeks

    const res = await postSync(cookie);

    expect(res.statusCode).toBe(200);
    expect(h.fakeMal.tokenGrants).toEqual(["authorization_code", "refresh_token"]);
  });

  it("asks for a fresh login when the MAL grant is gone", async () => {
    const cookie = await loginOk();
    await skipCooldown();
    h.fakeMal.invalidateAccessTokens();
    h.fakeMal.revokeRefreshTokens();

    const res = await postSync(cookie);

    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({
      error: "reauth_required",
      lastSync: { status: "failed", error: "reauth_required" },
    });
  });

  it("never follows a paging link off MAL's host (the token would leak)", async () => {
    const cookie = await loginOk();
    await skipCooldown();
    h.fakeMal.pageSize = 2;
    h.fakeMal.nextPageOverride = "https://evil.example/v2/users/@me/animelist?offset=2";
    const requestsBefore = h.fakeMal.animeListRequests.length;

    const res = await postSync(cookie);

    expect(res.statusCode).toBe(502);
    expect(res.json()).toMatchObject({ lastSync: { error: "invalid_response" } });
    expect(h.fakeMal.animeListRequests.length - requestsBefore).toBe(1);
  });

  it("requires a session and the web app's origin", async () => {
    const cookie = await loginOk();
    await skipCooldown();

    const anonymous = await h.app.inject({
      method: "POST",
      url: "/sync",
      headers: { origin: TEST_WEB_ORIGIN },
    });
    const crossSite = await h.app.inject({
      method: "POST",
      url: "/sync",
      headers: { origin: "https://evil.example" },
      cookies: { [SESSION_COOKIE]: cookie },
    });

    expect(anonymous.statusCode).toBe(401);
    expect(crossSite.statusCode).toBe(403);
  });
});

describe("GET /list", () => {
  it("requires a session", async () => {
    const res = await h.app.inject({ method: "GET", url: "/list" });
    expect(res.statusCode).toBe(401);
  });

  it("only returns the signed-in user's entries", async () => {
    const cookie = await loginOk();
    const [other] = await h.db
      .insert(users)
      .values({ malUserId: 1, malUsername: "someone_else" })
      .returning();
    if (!other) throw new Error("insert failed");
    await h.db.insert(anime).values({ malId: 800001, title: "Someone Else's Show" });
    await h.db.insert(listEntries).values({
      userId: other.id,
      animeId: 800001,
      status: "watching",
      score: 0,
      numEpisodesWatched: 1,
      isRewatching: false,
      malUpdatedAt: new Date(),
      syncedAt: new Date(),
    });

    const list = await getList(cookie);

    expect(list.entries).toHaveLength(6);
    expect(list.entries.map((e) => e.animeId)).not.toContain(800001);
  });

  it("reads from the mirror, never from MAL", async () => {
    const cookie = await loginOk();
    const requestsBefore = h.fakeMal.animeListRequests.length;

    await getList(cookie);
    await getList(cookie);

    expect(h.fakeMal.animeListRequests).toHaveLength(requestsBefore);
  });
});

describe("GET /me", () => {
  it("includes the last sync", async () => {
    const cookie = await loginOk();

    const res = await h.app.inject({
      method: "GET",
      url: "/me",
      cookies: { [SESSION_COOKIE]: cookie },
    });

    expect(res.json()).toMatchObject({
      lastSync: { status: "succeeded", trigger: "login", entriesCount: 6 },
    });
  });
});

describe("startup", () => {
  it("marks syncs left running by a crashed process as interrupted", async () => {
    await loginOk();
    const [user] = await h.db.select().from(users);
    if (!user) throw new Error("no user");
    await h.db.insert(syncRuns).values({ userId: user.id, trigger: "manual", status: "running" });

    // A fresh app instance (like a restart) recovers on boot.
    const restarted = await startHarness();
    await restarted.close();

    const running = await h.db.select().from(syncRuns).where(eq(syncRuns.status, "running"));
    expect(running).toHaveLength(0);
    const interrupted = await h.db.select().from(syncRuns).where(eq(syncRuns.error, "interrupted"));
    expect(interrupted).toHaveLength(1);
  });
});

describe("logging", () => {
  it("never writes tokens or codes to the logs during syncs", () => {
    const logs = h.logs.text;
    expect(logs).toContain("list sync succeeded");
    for (const secret of h.fakeMal.issuedSecrets) {
      expect(logs).not.toContain(secret);
    }
  });
});
