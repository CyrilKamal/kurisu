import { randomUUID } from "node:crypto";

import * as contract from "@kurisu/shared";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { SESSION_COOKIE } from "../../src/auth/sessions.js";
import { diaryNotes, friendships, listEntries, users } from "../../src/db/schema.js";
import { fixtureList } from "../fixtures/animeList.js";
import type { FakeListItem } from "../support/fakeMal.js";
import {
  backgroundSettled,
  login,
  resetDatabase,
  startHarness,
  TEST_MAL_USER,
  type Harness,
} from "../support/harness.js";
import { TEST_WEB_ORIGIN } from "../support/testConfig.js";

// TEST_MAL_USER owns this kurisu and invites the others.
const ALEX = { id: 5151, name: "alex" };
const SAM = { id: 6262, name: "sam" };

/** A finished TV show with a score, shaped like the fixture's. */
function scored(id: number, score: number): FakeListItem {
  const base = structuredClone(fixtureList()[1]);
  if (!base) throw new Error("fixture changed");
  return {
    node: { ...base.node, id, title: `Show ${String(id)}`, media_type: "tv" },
    list_status: { ...base.list_status, status: "completed", score },
  };
}

const SHOWS = [1, 2, 3, 4, 5, 6];
const OWNER_SCORES = [9, 8, 7, 6, 5, 10];
// Alex agrees with the owner and loves a show the owner hasn't got; Sam disagrees throughout.
const ALEX_SCORES = [9, 8, 7, 5, 4, 9];
const SAM_SCORES = [5, 6, 7, 8, 9, 4];
const ALEX_ONLY = 7;

let h: Harness;
const cookies = new Map<string, string>();

beforeAll(async () => {
  h = await startHarness({ env: { OWNER_MAL_USERNAME: TEST_MAL_USER.name } });
});
afterAll(() => h.close());
beforeEach(async () => {
  await resetDatabase(h.db);
  h.fakeMal.reset();
  cookies.clear();
  h.fakeMal.list = SHOWS.map((id, i) => scored(id, OWNER_SCORES[i] ?? 0));
  h.fakeMal.lists.set(ALEX.id, [
    ...SHOWS.map((id, i) => scored(id, ALEX_SCORES[i] ?? 0)),
    scored(ALEX_ONLY, 10),
  ]);
  h.fakeMal.lists.set(
    SAM.id,
    SHOWS.map((id, i) => scored(id, SAM_SCORES[i] ?? 0)),
  );
  await join(TEST_MAL_USER);
  await join(ALEX, await invite());
  await join(SAM, await invite());
  await backgroundSettled(h);
});

function send(
  who: { name: string },
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  url: string,
  payload?: object,
) {
  return h.app.inject({
    method,
    url,
    headers: { origin: TEST_WEB_ORIGIN },
    cookies: { [SESSION_COOKIE]: cookies.get(who.name) ?? "" },
    ...(payload === undefined ? {} : { payload }),
  });
}

async function join(user: { id: number; name: string }, inviteCode?: string) {
  h.fakeMal.user = user;
  const { sessionCookie } = await login(h, undefined, inviteCode);
  if (!sessionCookie) throw new Error(`${user.name} couldn't log in`);
  cookies.set(user.name, sessionCookie);
}

async function invite(): Promise<string> {
  const res = await send(TEST_MAL_USER, "POST", "/invites", {});
  return res.json<{ url: string }>().url.split("/invite/")[1] ?? "";
}

async function idOf(user: { id: number }): Promise<string> {
  const [row] = await h.db.select({ id: users.id }).from(users).where(eq(users.malUserId, user.id));
  if (!row) throw new Error("no account");
  return row.id;
}

async function friendsOf(user: { name: string }) {
  const res = await send(user, "GET", "/friends");
  expect(res.statusCode).toBe(200);
  return contract.friendsResponseSchema.parse(res.json());
}

describe("friends", () => {
  it("makes whoever joins with an invite friends with the inviter, and no one else", async () => {
    expect((await friendsOf(TEST_MAL_USER)).friends.map((f) => f.malUsername)).toEqual([
      "alex",
      "sam",
    ]);
    expect((await friendsOf(ALEX)).friends.map((f) => f.malUsername)).toEqual([TEST_MAL_USER.name]);
  });

  it("adds a friend through their link, once, and never yourself", async () => {
    const { link } = await friendsOf(ALEX);
    const code = link.split("/friend/")[1] ?? "";

    const check = await send(SAM, "GET", `/friends/links/${code}`);
    expect(contract.friendLinkCheckSchema.parse(check.json())).toEqual({
      owner: "alex",
      self: false,
      alreadyFriends: false,
    });
    const added = await send(SAM, "POST", "/friends", { code });
    expect(added.statusCode).toBe(201);
    expect((await send(SAM, "POST", "/friends", { code })).statusCode).toBe(201);
    expect(await h.db.select().from(friendships)).toHaveLength(3);
    expect((await friendsOf(SAM)).friends.map((f) => f.malUsername)).toContain("alex");

    expect((await send(ALEX, "POST", "/friends", { code })).json()).toEqual({ error: "own_link" });

    // A new link retires the old one.
    const reset = await send(ALEX, "POST", "/friends/link/reset");
    expect(reset.json<{ link: string }>().link).not.toBe(link);
    expect((await send(SAM, "GET", `/friends/links/${code}`)).statusCode).toBe(404);
  });

  it("matches tastes from the scores both gave", async () => {
    const { friends } = await friendsOf(TEST_MAL_USER);
    const alex = friends.find((f) => f.malUsername === "alex");
    const sam = friends.find((f) => f.malUsername === "sam");
    expect(alex?.match.sharedScored).toBe(6);
    expect(alex?.match.percent).toBeGreaterThan(60);
    expect(sam?.match.percent).toBeLessThan(40);

    const detail = contract.friendDetailResponseSchema.parse(
      (await send(TEST_MAL_USER, "GET", `/friends/${await idOf(ALEX)}`)).json(),
    );
    expect(detail.bothLoved.map((s) => s.animeId)).toEqual([6, 1, 2]);
    expect(detail.theyLoved).toEqual([expect.objectContaining({ animeId: ALEX_ONLY, theirs: 10 })]);
  });

  it("shows what a friend watched, with only the notes they shared", async () => {
    const edited = await send(ALEX, "POST", `/list/${String(ALEX_ONLY)}/edit`, {
      score: 9,
      requestId: randomUUID(),
    });
    expect(edited.statusCode).toBe(200);
    const alexId = await idOf(ALEX);
    const [entry] = await h.db
      .select({ animeId: listEntries.animeId })
      .from(listEntries)
      .where(eq(listEntries.userId, alexId));
    expect(entry).toBeDefined();

    const { activity } = await friendsOf(TEST_MAL_USER);
    expect(activity).toEqual([
      expect.objectContaining({
        friend: "alex",
        kind: "rated",
        animeId: ALEX_ONLY,
        score: 9,
        note: null,
      }),
    ]);

    // A diary note on that update stays private until alex shares it.
    const [change] = await h.db
      .execute<{ id: string }>(`select id from changes where user_id = '${alexId}'`)
      .then((r) => r.rows);
    if (!change) throw new Error("no change");
    const [note] = await h.db
      .insert(diaryNotes)
      .values({ userId: alexId, animeId: ALEX_ONLY, changeId: change.id, text: "so good" })
      .returning({ id: diaryNotes.id });
    if (!note) throw new Error("no note");
    expect((await friendsOf(TEST_MAL_USER)).activity[0]?.note).toBeNull();

    const shared = await send(ALEX, "PATCH", `/diary/notes/${note.id}`, { shared: true });
    expect(shared.json()).toEqual({ id: note.id, shared: true });
    expect((await friendsOf(TEST_MAL_USER)).activity[0]?.note).toBe("so good");
    // Nobody else can share alex's note.
    const notMine = await send(SAM, "PATCH", `/diary/notes/${note.id}`, { shared: false });
    expect(notMine.statusCode).toBe(404);
  });

  it("shows only the taste match of a friend who stopped sharing", async () => {
    await send(ALEX, "POST", `/list/${String(ALEX_ONLY)}/edit`, {
      score: 9,
      requestId: randomUUID(),
    });
    const off = await send(ALEX, "PUT", "/friends/sharing", { shareActivity: false });
    expect(off.json()).toEqual({ shareActivity: false });

    const { friends, activity } = await friendsOf(TEST_MAL_USER);
    expect(friends.find((f) => f.malUsername === "alex")).toMatchObject({ sharing: false });
    expect(activity).toEqual([]);
    const detail = contract.friendDetailResponseSchema.parse(
      (await send(TEST_MAL_USER, "GET", `/friends/${await idOf(ALEX)}`)).json(),
    );
    expect(detail.friend.match.percent).not.toBeNull();
    expect(detail.bothLoved).toEqual([]);
    expect(detail.theyLoved).toEqual([]);
    expect(detail.activity).toEqual([]);
  });

  it("keeps everything about a user from anyone who isn't their friend", async () => {
    const alexId = await idOf(ALEX);
    expect((await send(SAM, "GET", `/friends/${alexId}`)).statusCode).toBe(404);
    expect((await send(SAM, "DELETE", `/friends/${alexId}`)).statusCode).toBe(404);
    expect((await send(SAM, "GET", `/friends/${await idOf(SAM)}`)).statusCode).toBe(404);
    expect((await friendsOf(SAM)).activity.every((a) => a.friend !== "alex")).toBe(true);
  });

  it("removes a friend from both sides", async () => {
    const res = await send(ALEX, "DELETE", `/friends/${await idOf(TEST_MAL_USER)}`);
    expect(res.statusCode).toBe(204);
    expect((await friendsOf(ALEX)).friends).toEqual([]);
    expect((await friendsOf(TEST_MAL_USER)).friends.map((f) => f.malUsername)).toEqual(["sam"]);
  });
});
