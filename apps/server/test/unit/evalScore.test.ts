import { describe, expect, it } from "vitest";

import { aggregate, percentile, scoreCase, type CaseRun } from "../../eval/src/score.js";
import type { ListChange } from "../../src/writes/normalize.js";

function run(
  overrides: Omit<Partial<CaseRun>, "expected" | "actual"> & {
    expected?: [number, ListChange][];
    actual?: [number, ListChange][];
  },
): CaseRun {
  const { expected = [], actual = [], ...rest } = overrides;
  return {
    caseId: "c",
    tags: [],
    message: "m",
    expectClarify: false,
    asked: false,
    reply: "",
    error: null,
    latencyMs: 100,
    inputTokens: 10,
    outputTokens: 1,
    costUsd: 0,
    ...rest,
    expected: new Map(expected),
    actual: new Map(actual),
  };
}

describe("scoreCase", () => {
  it("needs the held adds to match too, and never counts them as writes", () => {
    const plan = { status: "plan_to_watch" as const };
    const right = run({
      expectClarify: true,
      asked: true,
      expectedAdds: new Map([[9, plan]]),
      actualAdds: new Map([[9, plan]]),
    });
    expect(scoreCase(right)).toMatchObject({
      correct: true,
      totalWrites: 0,
      wrongAdds: 0,
      totalAdds: 1,
    });

    const wrongShow = run({
      expectClarify: true,
      asked: true,
      expectedAdds: new Map([[9, plan]]),
      actualAdds: new Map([[8, plan]]),
    });
    expect(scoreCase(wrongShow)).toMatchObject({ correct: false, wrongWrites: 0, wrongAdds: 1 });

    const missing = run({ expectClarify: true, asked: true, expectedAdds: new Map([[9, plan]]) });
    expect(scoreCase(missing).correct).toBe(false);
  });

  it("is correct only when writes match exactly", () => {
    expect(
      scoreCase(
        run({ expected: [[1, { episodesWatched: 8 }]], actual: [[1, { episodesWatched: 8 }]] }),
      ),
    ).toEqual({
      correct: true,
      wrongWrites: 0,
      totalWrites: 1,
      missedWrites: 0,
      wrongAdds: 0,
      totalAdds: 0,
    });

    // Wrong value: one wrong write and one missed.
    expect(
      scoreCase(
        run({ expected: [[1, { episodesWatched: 8 }]], actual: [[1, { episodesWatched: 9 }]] }),
      ),
    ).toMatchObject({ correct: false, wrongWrites: 1, missedWrites: 1 });

    // An extra field on the right anime is wrong too.
    expect(
      scoreCase(
        run({
          expected: [[1, { episodesWatched: 8 }]],
          actual: [[1, { episodesWatched: 8, score: 9 }]],
        }),
      ),
    ).toMatchObject({ correct: false, wrongWrites: 1 });

    // A write to an anime nobody asked about.
    expect(scoreCase(run({ actual: [[2, { status: "dropped" }]] }))).toMatchObject({
      correct: false,
      wrongWrites: 1,
      totalWrites: 1,
    });

    // Nothing written when something was expected.
    expect(scoreCase(run({ expected: [[1, { episodesWatched: 8 }]] }))).toMatchObject({
      correct: false,
      missedWrites: 1,
    });
  });

  it("requires a question when one is expected, and tolerates an unneeded one", () => {
    expect(scoreCase(run({ expectClarify: true })).correct).toBe(false);
    expect(scoreCase(run({ expectClarify: true, asked: true })).correct).toBe(true);
    expect(
      scoreCase(run({ asked: true, expected: [[1, { score: 9 }]], actual: [[1, { score: 9 }]] }))
        .correct,
    ).toBe(true);
  });

  it("counts a run that errored as wrong", () => {
    expect(scoreCase(run({ error: "max_turns" })).correct).toBe(false);
  });
});

describe("aggregate", () => {
  it("computes the headline metrics", () => {
    const metrics = aggregate([
      run({
        expected: [[1, { episodesWatched: 8 }]],
        actual: [[1, { episodesWatched: 8 }]],
        latencyMs: 100,
        costUsd: 0.002,
      }),
      run({
        expected: [[1, { episodesWatched: 8 }]],
        actual: [[2, { episodesWatched: 8 }]],
        latencyMs: 300,
        costUsd: 0.004,
      }),
      run({ expectClarify: true, asked: true, latencyMs: 200 }),
      run({ asked: true, latencyMs: 400 }), // asked when it shouldn't have
    ]);

    expect(metrics).toMatchObject({
      cases: 4,
      updateAccuracy: 0.75,
      wrongWrites: 1,
      totalWrites: 2,
      wrongWriteRate: 0.5,
      clarificationPrecision: 0.5,
      clarificationRecall: 1,
      medianLatencyMs: 200,
      p90LatencyMs: 400,
      medianWriteLatencyMs: 100,
      errors: 0,
    });
    expect(metrics.costPerUpdateUsd).toBeCloseTo(0.003);
  });

  it("reports n/a instead of dividing by zero, and unknown cost as null", () => {
    const metrics = aggregate([run({ expected: [[1, { score: 1 }]], costUsd: null })]);
    expect(metrics.clarificationPrecision).toBeNull();
    expect(metrics.clarificationRecall).toBeNull();
    expect(metrics.costPerUpdateUsd).toBeNull();
    expect(metrics.wrongWriteRate).toBe(0);
  });
});

describe("percentile", () => {
  it("uses the nearest rank", () => {
    expect(percentile([5, 1, 3, 2, 4], 0.5)).toBe(3);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.9)).toBe(9);
    expect(percentile([], 0.5)).toBeNull();
  });
});
