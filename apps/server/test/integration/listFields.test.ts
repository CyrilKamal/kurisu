import * as contract from "@kurisu/shared";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { SESSION_COOKIE } from "../../src/auth/sessions.js";
import { changes, listEntries, users } from "../../src/db/schema.js";
import { commitProposal, createMalListWriter } from "../../src/writes/commit.js";
import { stageProposal } from "../../src/writes/stage.js";
import { fixtureList } from "../fixtures/animeList.js";
import { login, resetDatabase, startHarness, type Harness } from "../support/harness.js";
import { TEST_WEB_ORIGIN } from "../support/testConfig.js";

// The fixture's Watching show; MAL has comments, tags, a priority and a rewatch on it.
const WATCHING = 900001;

let h: Harness;
let session = "";
let userId = "";

beforeAll(async () => {
  h = await startHarness();
});
afterAll(() => h.close());
beforeEach(async () => {
  await resetDatabase(h.db);
  h.fakeMal.reset();
  const list = fixtureList();
  const watching = list.find((item) => item.node.id === WATCHING);
  if (!watching) throw new Error("fixture changed");
  Object.assign(watching.list_status, {
    comments: "Rewatch the finale",
    tags: ["comfy", "isekai"],
    priority: 2,
    num_times_rewatched: 1,
  });
  h.fakeMal.list = list;
  session = (await login(h)).sessionCookie ?? "";
  const [user] = await h.db.select({ id: users.id }).from(users);
  userId = user?.id ?? "";
});

function send(method: "GET" | "POST", url: string, payload?: object) {
  return h.app.inject({
    method,
    url,
    headers: { origin: TEST_WEB_ORIGIN },
    cookies: { [SESSION_COOKIE]: session },
    ...(payload === undefined ? {} : { payload }),
  });
}

async function entry(animeId = WATCHING) {
  const list = contract.listResponseSchema.parse((await send("GET", "/list")).json());
  const found = list.entries.find((e) => e.animeId === animeId);
  if (!found) throw new Error("not on the list");
  return found;
}

function edit(fields: object) {
  return send("POST", `/list/${String(WATCHING)}/edit`, {
    ...fields,
    requestId: crypto.randomUUID(),
  });
}

describe("MAL's other list fields", () => {
  it("are read from MAL by name and mirrored", async () => {
    const asked = h.fakeMal.animeListRequests.at(-1)?.searchParams.get("fields") ?? "";
    for (const field of ["comments", "tags", "priority", "num_times_rewatched", "status"]) {
      expect(asked).toContain(field);
    }
    expect(await entry()).toMatchObject({
      comments: "Rewatch the finale",
      tags: ["comfy", "isekai"],
      priority: 2,
      timesRewatched: 1,
    });
    // An entry the user never set them on has MAL's defaults.
    expect(await entry(900003)).toMatchObject({ comments: "", tags: [], priority: 0 });
  });

  it("change through the write path, logged with their prior values, and undo", async () => {
    const res = await edit({
      comments: "  Best ending of the season  ",
      tags: ["comfy", "isekai, cozy", "Comfy"],
      priority: 0,
      timesRewatched: 2,
    });
    expect(res.statusCode).toBe(200);
    expect(h.fakeMal.patchRequests).toEqual([
      {
        animeId: WATCHING,
        form: {
          priority: "0",
          num_times_rewatched: "2",
          tags: "comfy,isekai,cozy",
          comments: "Best ending of the season",
        },
      },
    ]);
    const change = contract.changeResponseSchema.parse(res.json()).change;
    expect(change.before).toEqual({
      comments: "Rewatch the finale",
      tags: ["comfy", "isekai"],
      priority: 2,
      timesRewatched: 1,
    });
    expect(change.after).toEqual({
      comments: "Best ending of the season",
      tags: ["comfy", "isekai", "cozy"],
      priority: 0,
      timesRewatched: 2,
    });
    expect(await entry()).toMatchObject({ tags: ["comfy", "isekai", "cozy"], priority: 0 });

    // The same tags in another order aren't a change.
    expect((await edit({ tags: ["cozy", "comfy", "isekai"] })).json()).toEqual({
      error: "no_change",
    });

    const undo = await send("POST", `/changes/${change.id}/undo`);
    expect(undo.statusCode).toBe(200);
    expect(await entry()).toMatchObject({
      comments: "Rewatch the finale",
      tags: ["comfy", "isekai"],
      priority: 2,
      timesRewatched: 1,
    });
  });

  it("come back when a removal is undone", async () => {
    const removed = await send("POST", `/list/${String(WATCHING)}/remove`, {
      requestId: crypto.randomUUID(),
    });
    const { change } = contract.changeResponseSchema.parse(removed.json());
    h.fakeMal.patchRequests.length = 0;
    expect((await send("POST", `/changes/${change.id}/undo`)).statusCode).toBe(200);
    expect(h.fakeMal.patchRequests[0]?.form).toMatchObject({
      comments: "Rewatch the finale",
      tags: "comfy,isekai",
      priority: "2",
      num_times_rewatched: "1",
    });
    expect(await entry()).toMatchObject({ comments: "Rewatch the finale", priority: 2 });
  });

  it("are checked, and can't be changed while MAL hasn't sent them", async () => {
    expect((await edit({ priority: 3 })).json()).toEqual({ error: "priority_out_of_range" });
    expect((await edit({ comments: "x".repeat(2001) })).json()).toEqual({
      error: "comments_too_long",
    });
    expect((await edit({ tags: ["x".repeat(51)] })).json()).toEqual({ error: "tag_too_long" });
    expect((await edit({ timesRewatched: -1 })).json()).toEqual({
      error: "rewatch_count_out_of_range",
    });

    await h.db
      .update(listEntries)
      .set({ comments: null })
      .where(and(eq(listEntries.userId, userId), eq(listEntries.animeId, WATCHING)));
    expect((await edit({ comments: "hello" })).json()).toEqual({ error: "field_unknown" });
    expect((await entry()).comments).toBeNull();
    expect(h.fakeMal.patchRequests).toEqual([]);
  });

  it("keep what MAL accepted when its reply leaves them out", async () => {
    h.fakeMal.patchRepliesWithExtras = false;
    expect((await edit({ comments: "Short and sweet" })).statusCode).toBe(200);
    expect((await entry()).comments).toBe("Short and sweet");
  });

  it("are refused as stale when the mirror moved since the proposal", async () => {
    const proposal = await stageProposal(h.db, {
      userId,
      animeId: WATCHING,
      source: "user",
      kind: "update",
      idempotencyKey: "user:stale-test",
      before: {
        status: "watching",
        episodesWatched: 7,
        score: 0,
        isRewatching: false,
        tags: ["comfy", "isekai"],
      },
      change: { tags: ["comfy"] },
    });
    // A sync brought in a tag added on MAL's site in the meantime.
    await h.db
      .update(listEntries)
      .set({ tags: ["comfy", "isekai", "rewatch"] })
      .where(and(eq(listEntries.userId, userId), eq(listEntries.animeId, WATCHING)));
    const writer = createMalListWriter({
      tokenStore: h.tokenStore,
      apiBaseUrl: h.config.mal.apiBaseUrl,
    });
    const result = await commitProposal(
      { db: h.db, writeListStatus: writer },
      userId,
      proposal.id,
      { confirmed: true },
    );
    expect(result).toEqual({ status: "failed", error: "stale" });
    expect(h.fakeMal.patchRequests).toEqual([]);
    expect(await h.db.select().from(changes)).toEqual([]);
  });
});
