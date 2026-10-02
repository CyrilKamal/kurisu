import { describe, expect, it } from "vitest";

import { markClear, type SearchCandidate } from "../../src/list/search.js";
import type { ListStatus } from "../../src/writes/normalize.js";
import { keyFor } from "../../src/writes/propose.js";

function candidate(
  animeId: number,
  matchScore: number,
  status: ListStatus = "completed",
  airingStatus = "finished_airing",
): Omit<SearchCandidate, "clear" | "clearBy"> {
  return {
    animeId,
    title: `Show ${String(animeId)}`,
    titleEn: null,
    mediaType: "tv",
    numEpisodes: 12,
    status,
    episodesWatched: 0,
    score: 0,
    isRewatching: false,
    airingStatus,
    matchScore,
    matchedName: `Show ${String(animeId)}`,
  };
}

const clearIds = (list: Omit<SearchCandidate, "clear" | "clearBy">[]) =>
  markClear(list)
    .filter((c) => c.clear)
    .map((c) => c.animeId);

describe("markClear", () => {
  it("a strong top match with a clear margin is clear", () => {
    expect(clearIds([candidate(1, 0.9), candidate(2, 0.5)])).toEqual([1]);
    expect(clearIds([candidate(1, 0.7)])).toEqual([1]);
  });

  it("a weak top match is never clear", () => {
    expect(clearIds([candidate(1, 0.5)])).toEqual([]);
  });

  it("near-ties are unclear", () => {
    expect(clearIds([candidate(1, 1), candidate(2, 0.95)])).toEqual([]);
  });

  it("breaks a tie when exactly one tied show is in progress (sequel seasons)", () => {
    // "frieren ep 5": season 1 completed, season 2 watching, both match "frieren" equally.
    expect(clearIds([candidate(1, 1, "completed"), candidate(2, 1, "watching")])).toEqual([2]);
    expect(clearIds([candidate(1, 1, "on_hold"), candidate(2, 1, "plan_to_watch")])).toEqual([1]);
  });

  it("says why a match is clear", () => {
    const [unique] = markClear([candidate(1, 0.9), candidate(2, 0.5)]);
    const tied = markClear([candidate(1, 1, "completed"), candidate(2, 1, "watching")]);
    expect(unique?.clearBy).toBe("unique");
    expect(tied.map((c) => c.clearBy)).toEqual([null, "only_in_progress"]);
  });

  it("stays unclear when several tied shows are in progress", () => {
    expect(clearIds([candidate(1, 1, "watching"), candidate(2, 1, "watching")])).toEqual([]);
  });

  it("a show that hasn't aired isn't in progress, even if the list says watching", () => {
    // "black clover ep 3": season 1 completed, season 2 parked in Watching before it airs.
    expect(
      clearIds([candidate(1, 1, "completed"), candidate(2, 1, "watching", "not_yet_aired")]),
    ).toEqual([]);
    // Once it airs, the tie-break picks it again.
    expect(
      clearIds([candidate(1, 1, "completed"), candidate(2, 1, "watching", "currently_airing")]),
    ).toEqual([2]);
    // A unique match is still clear; propose_update holds progress on it instead.
    expect(clearIds([candidate(1, 0.9, "watching", "not_yet_aired")])).toEqual([1]);
  });

  it("an in-progress show outside the tie doesn't count", () => {
    expect(
      clearIds([candidate(1, 1, "completed"), candidate(2, 0.99), candidate(3, 0.5, "watching")]),
    ).toEqual([]);
  });
});

describe("keyFor", () => {
  it("is stable regardless of field order and differs by run, anime and value", () => {
    const a = keyFor("run-1", 5, { status: "completed", episodesWatched: 12 });
    expect(keyFor("run-1", 5, { episodesWatched: 12, status: "completed" })).toBe(a);
    expect(keyFor("run-2", 5, { status: "completed", episodesWatched: 12 })).not.toBe(a);
    expect(keyFor("run-1", 6, { status: "completed", episodesWatched: 12 })).not.toBe(a);
    expect(keyFor("run-1", 5, { status: "completed", episodesWatched: 11 })).not.toBe(a);
  });
});
