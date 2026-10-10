import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { anime, listEntries, users } from "../../src/db/schema.js";
import { ensureTitleEmbeddings } from "../../src/lab/titles.js";
import { searchMyList, type SearchCandidate } from "../../src/list/search.js";
import type { Embedder } from "../../src/llm/modelClient.js";
import { fixtureList } from "../fixtures/animeList.js";
import { ConceptEmbedder } from "../support/conceptEmbedder.js";
import { login, resetDatabase, startHarness, type Harness } from "../support/harness.js";

let h: Harness;
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
  await login(h);
  const [user] = await h.db.select().from(users);
  if (!user) throw new Error("no user");
  userId = user.id;
});

const BLUE_SLOPE = 920101;
const SUN_SLOPE = 920102;
const APOLLON = 920103;

/** Adds made-up shows straight to the mirror, then embeds every listed show's names. */
async function addShows(embedder: Embedder, shows: { id: number; title: string }[]) {
  await h.db
    .insert(anime)
    .values(shows.map((s) => ({ malId: s.id, title: s.title, numEpisodes: 12 })));
  await h.db.insert(listEntries).values(
    shows.map((s) => ({
      userId,
      animeId: s.id,
      status: "plan_to_watch" as const,
      score: 0,
      numEpisodesWatched: 0,
      isRewatching: false,
      malUpdatedAt: new Date(),
      syncedAt: new Date(),
    })),
  );
  const listed = await h.db.select({ id: listEntries.animeId }).from(listEntries);
  await ensureTitleEmbeddings(
    { db: h.db, embedder },
    listed.map((row) => row.id),
  );
}

const ids = (found: SearchCandidate[]) => found.map((c) => c.animeId);

describe("list search with the lab's vector channel", () => {
  it("lets meaning reorder the shows the words found, without changing what's clear", async () => {
    const embedder = new ConceptEmbedder({ slope: "sun", "slope of the sun": "sun" });
    await addShows(embedder, [
      { id: BLUE_SLOPE, title: "Blue Slope Diaries" },
      { id: SUN_SLOPE, title: "Slope of the Sun" },
    ]);
    expect(embedder.calls[0]?.purpose).toBe("document");
    expect(embedder.calls[0]?.texts).toContain("Slope of the Sun");

    const byWords = await searchMyList(h.db, userId, ["slope"]);
    const withMeaning = await searchMyList(h.db, userId, ["slope"], { meaning: { embedder } });

    // Both names hold the word equally, so the words alone can't choose.
    expect(ids(byWords).slice(0, 2)).toEqual([BLUE_SLOPE, SUN_SLOPE]);
    expect(byWords.some((c) => c.clear)).toBe(false);
    expect(embedder.calls.at(-1)).toEqual({ texts: ["slope"], purpose: "query" });
    expect(ids(withMeaning).slice(0, 2)).toEqual([SUN_SLOPE, BLUE_SLOPE]);
    expect(withMeaning.some((c) => c.clear)).toBe(false);
    expect(withMeaning.every((c) => c.byMeaning === undefined)).toBe(true);
  });

  it("adds a show only the meaning found just when asked to, and never as clear", async () => {
    const embedder = new ConceptEmbedder({
      "the jazz one": "jazz",
      "sakamichi no apollon": "jazz",
    });
    await addShows(embedder, [{ id: APOLLON, title: "Sakamichi no Apollon" }]);

    const reordered = await searchMyList(h.db, userId, ["the jazz one"], { meaning: { embedder } });
    expect(ids(reordered)).not.toContain(APOLLON);

    const added = await searchMyList(h.db, userId, ["the jazz one"], {
      meaning: { embedder, extras: "always" },
    });
    const apollon = added.find((c) => c.animeId === APOLLON);
    expect(apollon).toMatchObject({ clear: false, clearBy: null, matchScore: 0 });
    expect(apollon?.byMeaning).toBeCloseTo(1, 2);
    // Not even when the user is answering a question.
    const answering = await searchMyList(h.db, userId, ["the jazz one"], {
      meaning: { embedder, extras: "always" },
      answering: true,
    });
    expect(answering.some((c) => c.clear)).toBe(false);
  });

  it("answers from the words alone when the embedder fails", async () => {
    const embedder = new ConceptEmbedder({});
    await addShows(embedder, [
      { id: BLUE_SLOPE, title: "Blue Slope Diaries" },
      { id: SUN_SLOPE, title: "Slope of the Sun" },
    ]);
    const failures: unknown[] = [];
    const down: Embedder = {
      model: embedder.model,
      dimensions: embedder.dimensions,
      embed: () => Promise.reject(new Error("ollama is down")),
    };
    const found = await searchMyList(h.db, userId, ["slope"], {
      meaning: { embedder: down, extras: "always", onError: (err) => failures.push(err) },
    });
    expect(found).toEqual(await searchMyList(h.db, userId, ["slope"]));
    expect(failures).toHaveLength(1);
  });
});
