import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { loadRecommendCases, type RecommendCase } from "../../eval/src/recommendCases.js";
import type { DetailsFreeze, DiscoveryFreeze, PoolShow } from "../../eval/src/recommendData.js";
import {
  aggregateRecommend,
  checkPick,
  scoreRecommendCase,
  type PickedShow,
  type RecommendRun,
} from "../../eval/src/recommendScore.js";
import type { Snapshot } from "../../eval/src/snapshot.js";

const entry = (id: number, title: string, status: Snapshot["entries"][number]["status"]) => ({
  id,
  title,
  titleEn: null,
  titleJa: null,
  synonyms: [],
  mediaType: "tv",
  numEpisodes: 12,
  status,
  episodesWatched: 0,
  isRewatching: false,
  airingStatus: "finished_airing",
});

const snapshot: Snapshot = {
  name: "my-list",
  description: "unit test",
  source: "synthetic",
  exportedAt: "2026-10-01T00:00:00.000Z",
  entries: [entry(1, "Mushishi", "plan_to_watch"), entry(2, "Monster", "dropped")],
};

const details: DetailsFreeze = {
  description: "test",
  source: "mal",
  snapshot: "my-list",
  frozenAt: "2026-10-06T00:00:00.000Z",
  shows: [
    { malId: 1, genres: ["Slice of Life", "Iyashikei"], episodeMinutes: 24, malMean: 8.7 },
    { malId: 2, genres: ["Mystery", "Suspense"], episodeMinutes: 24, malMean: 8.9 },
  ],
};

const poolShow = (malId: number, title: string, extra: Partial<PoolShow> = {}): PoolShow => ({
  malId,
  anilistId: malId + 1000,
  title,
  titleEn: null,
  titleJa: null,
  synonyms: [],
  mediaType: "movie",
  airingStatus: "finished_airing",
  numEpisodes: 1,
  episodeMinutes: 90,
  genres: ["Drama"],
  score: 8.5,
  popularity: 1000,
  coverUrl: null,
  startDate: "2020",
  prequelMalIds: [],
  strength: 0.5,
  ...extra,
});

const pool: DiscoveryFreeze = {
  description: "test",
  source: "anilist",
  frozenAt: "2026-10-06T00:00:00.000Z",
  shows: [
    poolShow(10, "Look Back", { episodeMinutes: 58 }),
    poolShow(11, "Akira", { genres: ["Action", "Sci-Fi"], titleEn: "Akira" }),
  ],
};

let dir: string | null = null;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = null;
});

function load(files: Record<string, string>) {
  dir = mkdtempSync(path.join(tmpdir(), "kurisu-rec-cases-"));
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(path.join(dir, name), content);
  }
  return loadRecommendCases(details, pool, `${dir}${path.sep}`, () => snapshot);
}

describe("loadRecommendCases", () => {
  it("loads cases with defaults and resolves must_not on the list, in the pool, or by id", () => {
    const result = load({
      "recommend-batch.yaml": `snapshot: my-list
cases:
  - id: rec-movie
    message: what movie should I watch
    expect:
      media_types: [movie]
      must_not: [Monster, Akira, 10]
  - id: rec-anything
    message: recommend me something
    expect: {}
`,
      // Not a recommendation file: left to the update loader.
      "batch.yaml": "snapshot: my-list\ncases: []\n",
    });

    expect(result.errors).toEqual([]);
    expect(result.cases.map((c) => c.case.id)).toEqual(["rec-movie", "rec-anything"]);
    expect([...(result.cases[0]?.mustNot ?? [])]).toEqual([2, 11, 10]);
    expect(result.cases[1]?.case.expect).toEqual({ picks: true, source: "any", must_not: [] });
  });

  it("rejects misspelled or unknown genres, unknown shows and repeated ids", () => {
    const result = load({
      "recommend-bad.yaml": `snapshot: my-list
cases:
  - id: rec-a
    message: something chill
    expect:
      genres_any: [slice of life, Cozy]
  - id: rec-a
    message: again
    expect: {}
  - id: rec-b
    message: no monster
    expect:
      must_not: [Monsters, 999]
`,
    });

    expect(result.errors.map((e) => e.message)).toEqual([
      'write "slice of life" as "Slice of Life".',
      `"Cozy" isn't a genre on the list or in the pool.`,
      "id also used in recommend-bad.yaml.",
      '"Monsters" matches no show on the list or in the pool (try pnpm eval:lookup).',
      "999 is neither on the list nor in the pool.",
    ]);
    expect(result.cases).toEqual([]);
  });

  it("needs the frozen data and a matching snapshot", () => {
    const file = {
      "recommend-x.yaml": "snapshot: other\ncases:\n  - id: x\n    message: hi\n    expect: {}\n",
    };
    expect(load(file).errors[0]?.message).toContain('not "other"');
    rmSync(dir ?? "", { recursive: true, force: true });
    dir = mkdtempSync(path.join(tmpdir(), "kurisu-rec-cases-"));
    writeFileSync(path.join(dir, "recommend-x.yaml"), "snapshot: my-list\ncases: []\n");
    const missing = loadRecommendCases(null, null, `${dir}${path.sep}`, () => snapshot);
    expect(missing.errors[0]?.message).toContain("pnpm eval:recommend-data");
  });
});

const expectOf = (fields: Partial<RecommendCase["expect"]> = {}): RecommendCase["expect"] => ({
  picks: true,
  source: "any",
  must_not: [],
  ...fields,
});

const pick = (fields: Partial<PickedShow> = {}): PickedShow => ({
  animeId: 1,
  title: "Mushishi",
  status: "plan_to_watch",
  isRewatching: false,
  inPool: false,
  mediaType: "tv",
  numEpisodes: 26,
  episodesWatched: 0,
  episodeMinutes: 24,
  genres: ["Slice of Life"],
  airingStatus: "finished_airing",
  ...fields,
});

describe("checkPick", () => {
  const messages = (p: PickedShow, e: RecommendCase["expect"], mustNot = new Set<number>()) =>
    checkPick(p, e, mustNot).map((v) => `${v.kind}: ${v.message}`);

  it("passes a pick within every label", () => {
    const labels = expectOf({
      media_types: ["tv", "ona"],
      max_episode_minutes: 30,
      genres_none: ["Horror"],
      source: "plan_to_watch",
    });
    expect(messages(pick(), labels)).toEqual([]);
  });

  it("names each broken label", () => {
    const labels = expectOf({
      media_types: ["movie"],
      max_episode_minutes: 20,
      genres_none: ["slice of life"],
      source: "new",
    });
    expect(messages(pick(), labels, new Set([1]))).toEqual([
      "constraint: must not be picked",
      "constraint: a tv, not movie",
      "constraint: 24-minute episodes, over 20",
      "constraint: has slice of life",
      "constraint: on your list, but something new was asked for",
    ]);
    expect(messages(pick({ episodeMinutes: null }), expectOf({ max_episode_minutes: 30 }))).toEqual(
      ["constraint: episode length unknown"],
    );
  });

  it("counts the episodes left to watch", () => {
    const labels = expectOf({ max_episodes_left: 13 });
    expect(messages(pick(), labels)).toEqual(["constraint: 26 episodes left, over 13"]);
    expect(messages(pick({ episodesWatched: 14 }), labels)).toEqual([]);
    expect(messages(pick({ numEpisodes: null }), labels)).toEqual([
      "constraint: episode count unknown",
    ]);
  });

  it("checks where a pick came from", () => {
    const fresh = pick({ status: null, inPool: true });
    expect(messages(fresh, expectOf({ source: "list" }))).toEqual([
      "constraint: new to you, but your list was asked for",
    ]);
    expect(messages(fresh, expectOf({ source: "new" }))).toEqual([]);
    expect(messages(pick({ status: "on_hold" }), expectOf({ source: "in_progress" }))).toEqual([]);
    expect(
      messages(
        pick({ status: "completed", isRewatching: true }),
        expectOf({ source: "in_progress" }),
      ),
    ).toEqual([]);
    expect(messages(pick(), expectOf({ source: "in_progress" }))).toEqual([
      "constraint: not a show in progress",
    ]);
  });

  it("flags picks that couldn't be recommended at all", () => {
    expect(messages(pick({ status: "completed" }), expectOf())).toEqual([
      "invalid: already completed",
    ]);
    expect(messages(pick({ status: "dropped" }), expectOf())).toEqual(["invalid: dropped"]);
    expect(messages(pick({ status: null, inPool: false }), expectOf())).toEqual([
      "invalid: neither on the list nor in the pool",
    ]);
    expect(messages(pick({ airingStatus: "not_yet_aired" }), expectOf())).toEqual([
      "invalid: hasn't aired yet",
    ]);
  });
});

function run(fields: Partial<RecommendRun> = {}): RecommendRun {
  return {
    file: "recommend-x.yaml",
    caseId: "x",
    tags: [],
    message: "m",
    handedOff: true,
    picks: [pick()],
    reply: "",
    error: null,
    latencyMs: 1000,
    costUsd: 0.01,
    inputTokens: 100,
    outputTokens: 10,
    ...fields,
  } as RecommendRun;
}

describe("scoreRecommendCase", () => {
  it("is right when the request reached the recommender and every pick fits", () => {
    const score = scoreRecommendCase(run(), expectOf({ genres_any: ["Comedy"] }), new Set());
    expect(score).toMatchObject({ correct: true, reasons: [], genreFit: { fit: 0, total: 1 } });
  });

  it("explains each way a case fails", () => {
    expect(
      scoreRecommendCase(run({ handedOff: false, picks: [] }), expectOf(), new Set()).reasons,
    ).toEqual(["never reached the recommender", "no picks"]);
    expect(scoreRecommendCase(run(), expectOf({ picks: false }), new Set()).reasons).toEqual([
      "picked shows when nothing should fit",
    ]);
    expect(
      scoreRecommendCase(run(), expectOf({ media_types: ["movie"] }), new Set()).reasons,
    ).toEqual(["picks break the labels"]);
    expect(
      scoreRecommendCase(run({ picks: [] }), expectOf({ picks: false }), new Set()).correct,
    ).toBe(true);
  });
});

describe("aggregateRecommend", () => {
  it("counts valid picks, picks within the labels and genre fit", () => {
    const labels = expectOf({ media_types: ["tv"], genres_any: ["Slice of Life"] });
    const runs = [
      run({ picks: [pick(), pick({ animeId: 2, mediaType: "movie" })] }),
      run({ picks: [pick({ animeId: 3, status: "dropped" })], latencyMs: 3000, costUsd: 0.03 }),
    ];
    const metrics = aggregateRecommend(
      runs.map((r) => ({ run: r, score: scoreRecommendCase(r, labels, new Set()) })),
    );
    expect(metrics).toMatchObject({
      cases: 2,
      correct: 0,
      handedOff: 2,
      picks: 3,
      validPicks: 2,
      withinLabels: 1,
      genreFit: { fit: 3, total: 3 },
      medianLatencyMs: 1000,
      p90LatencyMs: 3000,
      errors: 0,
    });
    expect(metrics.costPerCaseUsd).toBeCloseTo(0.02);
  });
});
