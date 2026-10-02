import { randomUUID } from "node:crypto";

import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { agentRuns, changes, listEntries, proposals, users } from "../../src/db/schema.js";
import { searchMyList } from "../../src/list/search.js";
import { commitProposal, createMalListWriter, type ListWriter } from "../../src/writes/commit.js";
import { proposeUpdate, type ProposeInput } from "../../src/writes/propose.js";
import { cancelProposal, undoChange } from "../../src/writes/undo.js";
import { fixtureList } from "../fixtures/animeList.js";
import { login, resetDatabase, startHarness, type Harness } from "../support/harness.js";

let h: Harness;
let userId: string;
let writer: ListWriter;
let runId: string;

const WATCHING = 900001; // Fixture Watching Show: watching, 7 / 12
const ON_HOLD = 900003; // Fixture Paused Show: on_hold, 10 / 24
const NOT_AIRED = 900005; // Fixture Unannounced Sequel: plan_to_watch, not yet aired, ? episodes

beforeAll(async () => {
  h = await startHarness();
  writer = createMalListWriter({
    tokenStore: h.tokenStore,
    apiBaseUrl: h.config.mal.apiBaseUrl,
    retry: { retries: 2, baseDelayMs: 1, maxDelayMs: 5 },
  });
});

afterAll(async () => {
  await h.close();
});

beforeEach(async () => {
  await resetDatabase(h.db);
  h.fakeMal.reset();
  h.fakeMal.list = fixtureList();
  await login(h); // mirrors the fixture list
  const [user] = await h.db.select().from(users);
  if (!user) throw new Error("no user");
  userId = user.id;
  runId = await newRun();
});

const deps = () => ({ db: h.db, writeListStatus: writer });

/** Proposals belong to an agent run; tests stand in for one. */
async function newRun(): Promise<string> {
  const [run] = await h.db
    .insert(agentRuns)
    .values({ userId, promptVersion: "test", model: "test:model" })
    .returning({ id: agentRuns.id });
  if (!run) throw new Error("run insert failed");
  return run.id;
}

async function propose(input: Partial<ProposeInput> & { animeId: number }) {
  const result = await proposeUpdate(h.db, { userId, runId, clearMatch: true, ...input });
  if (!result.ok) throw new Error(`propose failed: ${result.error}`);
  return result.proposal;
}

async function mirrorOf(animeId: number) {
  const [row] = await h.db
    .select()
    .from(listEntries)
    .where(and(eq(listEntries.userId, userId), eq(listEntries.animeId, animeId)));
  return row;
}

describe("propose → commit", () => {
  it("writes to MAL once, updates the mirror from MAL, and logs the change", async () => {
    const proposal = await propose({ animeId: WATCHING, episodesWatched: 8 });
    expect(proposal).toMatchObject({
      status: "pending",
      change: { episodesWatched: 8 },
      before: { status: "watching", episodesWatched: 7, score: 0, isRewatching: false },
      requiresConfirmation: false,
    });

    const result = await commitProposal(deps(), userId, proposal.id);

    expect(result).toMatchObject({ status: "committed", alreadyCommitted: false });
    expect(h.fakeMal.patchRequests).toEqual([
      { animeId: WATCHING, form: { num_watched_episodes: "8" } },
    ]);
    expect((await mirrorOf(WATCHING))?.numEpisodesWatched).toBe(8);
    const [change] = await h.db.select().from(changes);
    expect(change).toMatchObject({
      animeId: WATCHING,
      before: { episodesWatched: 7 },
      after: { episodesWatched: 8 },
      undoneByChangeId: null,
    });
  });

  it("stores relative progress as an absolute value, so retries never double-count", async () => {
    const proposal = await propose({ animeId: WATCHING, episodesDelta: 2 });
    expect(proposal.change).toEqual({ episodesWatched: 9 });

    const first = await commitProposal(deps(), userId, proposal.id);
    const retry = await commitProposal(deps(), userId, proposal.id);

    expect(first).toMatchObject({ status: "committed", alreadyCommitted: false });
    expect(retry).toMatchObject({ status: "committed", alreadyCommitted: true });
    expect(h.fakeMal.patchRequests).toHaveLength(1);
    expect((await mirrorOf(WATCHING))?.numEpisodesWatched).toBe(9);
  });

  it("sends one PATCH however many commits race for the same proposal", async () => {
    const proposal = await propose({ animeId: WATCHING, episodesWatched: 10 });
    // Open several pooled connections first, so the commits below really run concurrently
    // instead of queueing behind connection setup.
    await Promise.all(Array.from({ length: 6 }, () => h.db.execute(sql`SELECT pg_sleep(0.05)`)));

    const results = await Promise.all(
      Array.from({ length: 5 }, () => commitProposal(deps(), userId, proposal.id)),
    );

    expect(h.fakeMal.patchRequests).toHaveLength(1);
    const fresh = results.filter((r) => r.status === "committed" && !r.alreadyCommitted);
    expect(fresh).toHaveLength(1);
    expect(results.every((r) => r.status === "committed" || r.status === "in_progress")).toBe(true);
    expect(await h.db.select().from(changes)).toHaveLength(1);
  });

  it("returns the same proposal when the same change is proposed twice in a run", async () => {
    const a = await propose({ animeId: WATCHING, episodesWatched: 8 });
    const b = await propose({ animeId: WATCHING, episodesWatched: 8 });
    runId = await newRun();
    const c = await propose({ animeId: WATCHING, episodesWatched: 8 });

    expect(b.id).toBe(a.id);
    expect(c.id).not.toBe(a.id);
  });

  it("applies the normalization rules to what gets written", async () => {
    const proposal = await propose({ animeId: WATCHING, episodesWatched: 12 });
    await commitProposal(deps(), userId, proposal.id);

    expect(h.fakeMal.patchRequests[0]?.form).toEqual({
      status: "completed",
      num_watched_episodes: "12",
    });
    expect(await mirrorOf(WATCHING)).toMatchObject({ status: "completed", numEpisodesWatched: 12 });
  });

  it("isolates users: another user's proposal can't be committed", async () => {
    const proposal = await propose({ animeId: WATCHING, episodesWatched: 8 });
    const result = await commitProposal(deps(), randomUUID(), proposal.id);

    expect(result).toEqual({ status: "not_found" });
    expect(h.fakeMal.patchRequests).toHaveLength(0);
  });
});

describe("the confirmation gate", () => {
  it("holds an unclear match until the user confirms", async () => {
    const proposal = await propose({ animeId: WATCHING, episodesWatched: 8, clearMatch: false });
    expect(proposal).toMatchObject({
      requiresConfirmation: true,
      confirmationReason: "ambiguous_match",
    });

    const held = await commitProposal(deps(), userId, proposal.id);
    expect(held.status).toBe("needs_confirmation");
    expect(h.fakeMal.patchRequests).toHaveLength(0);

    const confirmed = await commitProposal(deps(), userId, proposal.id, { confirmed: true });
    expect(confirmed.status).toBe("committed");
    expect(h.fakeMal.patchRequests).toHaveLength(1);
  });

  it("holds progress that goes backwards", async () => {
    const proposal = await propose({ animeId: WATCHING, episodesWatched: 3 });
    expect(proposal).toMatchObject({
      requiresConfirmation: true,
      confirmationReason: "progress_backwards",
    });
  });

  it("holds progress on a show MAL says hasn't aired, but not status changes", async () => {
    const started = await propose({ animeId: NOT_AIRED, episodesWatched: 1 });
    expect(started).toMatchObject({
      change: { episodesWatched: 1, status: "watching" },
      requiresConfirmation: true,
      confirmationReason: "not_yet_aired",
    });
    expect(await propose({ animeId: NOT_AIRED, status: "completed" })).toMatchObject({
      confirmationReason: "not_yet_aired",
    });

    const dropped = await propose({ animeId: NOT_AIRED, status: "dropped" });
    expect(dropped).toMatchObject({ requiresConfirmation: false, confirmationReason: null });
  });

  it("lets the user cancel a held proposal", async () => {
    const proposal = await propose({ animeId: WATCHING, episodesWatched: 8, clearMatch: false });

    expect(await cancelProposal(h.db, userId, proposal.id)).toBe("cancelled");
    expect(await commitProposal(deps(), userId, proposal.id, { confirmed: true })).toEqual({
      status: "cancelled",
    });
    expect(h.fakeMal.patchRequests).toHaveLength(0);
  });
});

describe("refusals and failures", () => {
  it("rejects proposals that can't be right", async () => {
    const attempts: Partial<ProposeInput>[] = [
      { animeId: 123456, episodesWatched: 1 }, // not on the list
      { animeId: WATCHING, episodesWatched: 13 }, // the show has 12
      { animeId: WATCHING, episodesWatched: 7 }, // already at 7
      { animeId: WATCHING, episodesWatched: 8, episodesDelta: 1 },
      { animeId: WATCHING },
    ];
    const errors = [];
    for (const attempt of attempts) {
      const result = await proposeUpdate(h.db, {
        userId,
        runId,
        clearMatch: true,
        animeId: WATCHING,
        ...attempt,
      });
      errors.push(result.ok ? "ok" : result.error);
    }
    expect(errors).toEqual([
      "not_on_list",
      "episodes_exceed_total",
      "no_change",
      "both_episode_forms",
      "no_change_requested",
    ]);
  });

  it("refuses a stale proposal when the entry changed after it was proposed", async () => {
    const proposal = await propose({ animeId: WATCHING, episodesDelta: 1 }); // 7 -> 8
    await h.db
      .update(listEntries)
      .set({ numEpisodesWatched: 10 }) // e.g. a re-sync picked up an edit made on MAL
      .where(and(eq(listEntries.userId, userId), eq(listEntries.animeId, WATCHING)));

    const result = await commitProposal(deps(), userId, proposal.id);

    expect(result).toEqual({ status: "failed", error: "stale" });
    expect(h.fakeMal.patchRequests).toHaveLength(0);
    const [row] = await h.db.select().from(proposals).where(eq(proposals.id, proposal.id));
    expect(row).toMatchObject({ status: "failed", error: "stale" });
  });

  it("reports MAL outages and lets the same proposal be retried later", async () => {
    const proposal = await propose({ animeId: WATCHING, episodesWatched: 8 });
    h.fakeMal.patchFailures = [503, 503, 503];

    const failed = await commitProposal(deps(), userId, proposal.id);
    expect(failed).toEqual({ status: "failed", error: "mal_unavailable" });
    expect((await mirrorOf(WATCHING))?.numEpisodesWatched).toBe(7);

    const retried = await commitProposal(deps(), userId, proposal.id);
    expect(retried.status).toBe("committed");
    expect((await mirrorOf(WATCHING))?.numEpisodesWatched).toBe(8);
  });

  it("reports a request MAL rejects", async () => {
    const proposal = await propose({ animeId: WATCHING, episodesWatched: 8 });
    h.fakeMal.patchFailures = [400];

    expect(await commitProposal(deps(), userId, proposal.id)).toEqual({
      status: "failed",
      error: "mal_rejected",
    });
  });

  it("refreshes the token once when MAL rejects it", async () => {
    const proposal = await propose({ animeId: WATCHING, episodesWatched: 8 });
    h.fakeMal.invalidateAccessTokens();

    const result = await commitProposal(deps(), userId, proposal.id);

    expect(result.status).toBe("committed");
    expect(h.fakeMal.tokenGrants).toContain("refresh_token");
  });
});

describe("undo", () => {
  async function commitOne(input: Partial<ProposeInput> & { animeId: number }) {
    const proposal = await propose(input);
    const result = await commitProposal(deps(), userId, proposal.id);
    if (result.status !== "committed") throw new Error(`commit failed: ${result.status}`);
    return result.change;
  }

  it("restores the prior values on MAL through the same write path", async () => {
    const change = await commitOne({ animeId: WATCHING, episodesWatched: 12 }); // completes it
    h.fakeMal.patchRequests.length = 0;

    const result = await undoChange(deps(), userId, change.id);

    expect(result.status).toBe("committed");
    expect(h.fakeMal.patchRequests).toEqual([
      { animeId: WATCHING, form: { status: "watching", num_watched_episodes: "7" } },
    ]);
    expect(await mirrorOf(WATCHING)).toMatchObject({ status: "watching", numEpisodesWatched: 7 });
    const [original] = await h.db.select().from(changes).where(eq(changes.id, change.id));
    expect(original?.undoneByChangeId).toEqual(expect.any(String));
  });

  it("undoes once, however many times Undo is pressed", async () => {
    const change = await commitOne({ animeId: WATCHING, episodesWatched: 8 });
    h.fakeMal.patchRequests.length = 0;

    await undoChange(deps(), userId, change.id);
    const again = await undoChange(deps(), userId, change.id);

    expect(again.status).toBe("already_undone");
    expect(h.fakeMal.patchRequests).toHaveLength(1);
  });

  it("refuses to undo over a newer change", async () => {
    const first = await commitOne({ animeId: WATCHING, episodesWatched: 8 });
    runId = await newRun();
    await commitOne({ animeId: WATCHING, episodesWatched: 9 });
    h.fakeMal.patchRequests.length = 0;

    expect(await undoChange(deps(), userId, first.id)).toEqual({ status: "changed_since" });
    expect(h.fakeMal.patchRequests).toHaveLength(0);
  });
});

describe("search_my_list", () => {
  it("finds shows by any of their names, fuzzily", async () => {
    const byTitle = await searchMyList(h.db, userId, ["fixture watching show"]);
    const bySynonym = await searchMyList(h.db, userId, ["FWS"]);
    const byEnglish = await searchMyList(h.db, userId, ["the watching show"]);
    const typo = await searchMyList(h.db, userId, ["watchng show"]);

    for (const result of [byTitle, bySynonym, byEnglish, typo]) {
      expect(result[0]).toMatchObject({ animeId: WATCHING, clear: true });
    }
    expect(bySynonym[0]?.matchedName).toBe("FWS");
  });

  it("returns MAL's airing status with each entry", async () => {
    const [aired] = await searchMyList(h.db, userId, ["fixture watching show"]);
    const [upcoming] = await searchMyList(h.db, userId, ["fixture unannounced sequel"]);
    expect(aired?.airingStatus).toBe("finished_airing");
    expect(upcoming).toMatchObject({ animeId: NOT_AIRED, airingStatus: "not_yet_aired" });
  });

  it("takes the best score across query variants", async () => {
    const result = await searchMyList(h.db, userId, ["zzzz nothing", "paused show"]);
    expect(result[0]).toMatchObject({ animeId: ON_HOLD, clear: true });
  });

  it("marks a vague query as unclear and returns nothing for no match", async () => {
    const vague = await searchMyList(h.db, userId, ["fixture"]);
    expect(vague.length).toBeGreaterThan(1);
    expect(vague.some((c) => c.clear)).toBe(false);

    expect(await searchMyList(h.db, userId, ["qqqqqq"])).toEqual([]);
  });

  it("only searches the user's own list", async () => {
    const [other] = await h.db
      .insert(users)
      .values({ malUserId: 1, malUsername: "someone_else" })
      .returning();
    if (!other) throw new Error("insert failed");

    expect(await searchMyList(h.db, other.id, ["fixture watching show"])).toEqual([]);
  });
});
