import { describe, expect, it } from "vitest";

import type { DiaryEntryRow } from "../../src/diary/load.js";
import { activityOf } from "../../src/friends/activity.js";
import { cosine } from "../../src/friends/match.js";

function entry(overrides: Partial<DiaryEntryRow>): DiaryEntryRow {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    origin: "kurisu",
    kind: "update",
    animeId: 1,
    title: "Frieren",
    pictureUrl: null,
    before: {},
    after: {},
    at: new Date("2026-10-09T12:00:00Z"),
    note: null,
    ...overrides,
  };
}

describe("activityOf", () => {
  it("reads finishing, dropping, starting and watching", () => {
    expect(
      activityOf(
        entry({ before: { status: "watching" }, after: { status: "completed", score: 9 } }),
      ),
    ).toMatchObject({ kind: "finished", score: 9 });
    expect(
      activityOf(entry({ before: { status: "watching" }, after: { status: "dropped" } })),
    ).toMatchObject({ kind: "dropped" });
    expect(
      activityOf(entry({ before: { episodesWatched: 0 }, after: { episodesWatched: 2 } })),
    ).toMatchObject({ kind: "started", fromEpisode: 1, toEpisode: 2 });
    expect(
      activityOf(entry({ before: { episodesWatched: 4 }, after: { episodesWatched: 5 } })),
    ).toMatchObject({ kind: "watched", fromEpisode: 5, toEpisode: 5 });
    expect(
      activityOf(entry({ kind: "add", before: {}, after: { status: "plan_to_watch" } })),
    ).toMatchObject({ kind: "planned" });
    expect(activityOf(entry({ before: { score: 7 }, after: { score: 8 } }))).toMatchObject({
      kind: "rated",
      score: 8,
    });
  });

  it("leaves out removals and anything a friend wouldn't care about", () => {
    expect(activityOf(entry({ kind: "remove", after: { status: "watching" } }))).toBeNull();
    expect(activityOf(entry({ before: { score: 7 }, after: { score: 0 } }))).toBeNull();
    expect(
      activityOf(entry({ before: { isRewatching: false }, after: { isRewatching: true } })),
    ).toBeNull();
  });

  it("carries a diary note only when it was shared", () => {
    const update = { before: { episodesWatched: 4 }, after: { episodesWatched: 5 } };
    expect(
      activityOf(entry({ ...update, note: { id: "n", text: "wow", shared: false } }))?.note,
    ).toBeNull();
    expect(
      activityOf(entry({ ...update, note: { id: "n", text: "wow", shared: true } }))?.note,
    ).toBe("wow");
  });
});

describe("cosine", () => {
  it("is 1 for the same direction, -1 for opposite, and 0 with nothing to compare", () => {
    expect(cosine([1, 2, 3], [2, 4, 6])).toBeCloseTo(1);
    expect(cosine([1, -1], [-1, 1])).toBeCloseTo(-1);
    expect(cosine([0, 0], [1, 2])).toBe(0);
    expect(cosine([], [])).toBe(0);
  });
});
