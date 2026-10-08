import {
  changeResponseSchema,
  changesResponseSchema,
  editErrorResponseSchema,
} from "@kurisu/shared";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { SESSION_COOKIE } from "../../src/auth/sessions.js";
import { listEntries, proposals, users } from "../../src/db/schema.js";
import { fixtureList } from "../fixtures/animeList.js";
import {
  backgroundSettled,
  login,
  resetDatabase,
  startHarness,
  type Harness,
} from "../support/harness.js";
import { TEST_WEB_ORIGIN } from "../support/testConfig.js";

const WATCHING = 900001; // Fixture Watching Show: watching, ep 7 of 12
const DROPPED = 900004; // Fixture Dropped Show

let h: Harness;
let cookie: string;
let userId: string;

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
  cookie = (await login(h)).sessionCookie ?? "";
  await backgroundSettled(h);
  const [user] = await h.db.select({ id: users.id }).from(users);
  if (!user) throw new Error("no user");
  userId = user.id;
});

function post(url: string, body: unknown, headers: Record<string, string> = {}) {
  return h.app.inject({
    method: "POST",
    url,
    headers: { origin: TEST_WEB_ORIGIN, ...headers },
    cookies: { [SESSION_COOKIE]: cookie },
    payload: body as Record<string, unknown>,
  });
}

async function entry(animeId: number) {
  const [row] = await h.db
    .select()
    .from(listEntries)
    .where(and(eq(listEntries.userId, userId), eq(listEntries.animeId, animeId)));
  return row ?? null;
}

const id = () => crypto.randomUUID();

describe("editing an entry on the List screen", () => {
  it("writes to MAL through a proposal, logs it as the user's, and undo puts it back", async () => {
    const res = await post(`/list/${String(WATCHING)}/edit`, {
      episodesWatched: 9,
      score: 8,
      requestId: id(),
    });

    expect(res.statusCode).toBe(200);
    const { change } = changeResponseSchema.parse(res.json());
    expect(change).toMatchObject({
      animeId: WATCHING,
      kind: "update",
      before: { episodesWatched: 7, score: 0 },
      after: { episodesWatched: 9, score: 8 },
      source: "user",
      isUndo: false,
    });
    expect(h.fakeMal.patchRequests).toEqual([
      {
        animeId: WATCHING,
        form: expect.objectContaining({ num_watched_episodes: "9", score: "8" }),
      },
    ]);
    expect(await entry(WATCHING)).toMatchObject({ numEpisodesWatched: 9, score: 8 });
    const [proposal] = await h.db.select().from(proposals);
    expect(proposal).toMatchObject({ source: "user", runId: null, status: "committed" });

    // History shows it as the user's, and Undo restores the old values.
    const history = changesResponseSchema.parse(
      (
        await h.app.inject({
          method: "GET",
          url: "/changes",
          cookies: { [SESSION_COOKIE]: cookie },
        })
      ).json(),
    );
    expect(history.changes[0]).toMatchObject({ id: change.id, source: "user" });
    const undo = await post(`/changes/${change.id}/undo`, undefined);
    expect(undo.statusCode).toBe(200);
    expect(await entry(WATCHING)).toMatchObject({ numEpisodesWatched: 7, score: 0 });
  });

  it("applies the same rules as Chat: completing fills in the episodes", async () => {
    const res = await post(`/list/${String(WATCHING)}/edit`, {
      status: "completed",
      requestId: id(),
    });
    expect(changeResponseSchema.parse(res.json()).change.after).toEqual({
      status: "completed",
      episodesWatched: 12,
    });
  });

  it("writes once when the same tap is sent twice", async () => {
    const requestId = id();
    const first = await post(`/list/${String(WATCHING)}/edit`, { episodesWatched: 8, requestId });
    const second = await post(`/list/${String(WATCHING)}/edit`, { episodesWatched: 8, requestId });

    expect(second.statusCode).toBe(200);
    expect(changeResponseSchema.parse(second.json()).change.id).toBe(
      changeResponseSchema.parse(first.json()).change.id,
    );
    expect(h.fakeMal.patchRequests).toHaveLength(1);
  });

  it("turns down edits that break the rules, before writing anything", async () => {
    const cases: [unknown, string][] = [
      [{ episodesWatched: 13, requestId: id() }, "episodes_exceed_total"],
      [{ episodesWatched: 7, requestId: id() }, "no_change"],
      [{ score: 11, requestId: id() }, "invalid_edit"],
      [{ episodesWatched: 8 }, "invalid_edit"],
    ];
    for (const [body, error] of cases) {
      const res = await post(`/list/${String(WATCHING)}/edit`, body);
      expect(res.statusCode).toBe(400);
      expect(editErrorResponseSchema.parse(res.json()).error).toBe(error);
    }
    const notOnList = await post("/list/999999/edit", { score: 5, requestId: id() });
    expect(notOnList.statusCode).toBe(409);
    expect(h.fakeMal.patchRequests).toEqual([]);
  });

  it("needs the app's origin and a session", async () => {
    const res = await post(
      `/list/${String(WATCHING)}/edit`,
      { score: 5, requestId: id() },
      { origin: "https://evil.example" },
    );
    expect(res.statusCode).toBe(403);
    const anonymous = await h.app.inject({
      method: "POST",
      url: `/list/${String(WATCHING)}/edit`,
      headers: { origin: TEST_WEB_ORIGIN },
      payload: { score: 5, requestId: id() },
    });
    expect(anonymous.statusCode).toBe(401);
  });
});

describe("removing a show", () => {
  it("deletes it from MAL and the mirror, and undo puts it back as it was", async () => {
    const requestId = id();
    const res = await post(`/list/${String(DROPPED)}/remove`, { requestId });

    expect(res.statusCode).toBe(200);
    const { change } = changeResponseSchema.parse(res.json());
    expect(change).toMatchObject({ kind: "remove", source: "user" });
    expect(h.fakeMal.deleteRequests).toEqual([DROPPED]);
    expect(await entry(DROPPED)).toBeNull();

    // The same tap again reports the same removal.
    const again = await post(`/list/${String(DROPPED)}/remove`, { requestId });
    expect(changeResponseSchema.parse(again.json()).change.id).toBe(change.id);
    expect(h.fakeMal.deleteRequests).toHaveLength(1);

    const undo = await post(`/changes/${change.id}/undo`, undefined);
    expect(undo.statusCode).toBe(200);
    expect(await entry(DROPPED)).toMatchObject({ status: "dropped", numEpisodesWatched: 2 });
  });
});
