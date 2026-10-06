import type { ListChange } from "../../src/writes/normalize.js";

/** What happened when the agent handled one case. */
export interface CaseRun {
  caseId: string;
  tags: string[];
  message: string;
  expectClarify: boolean;
  /** Expected change per anime id (already normalized). */
  expected: Map<number, ListChange>;
  /** Committed change per anime id: the final values of the fields that changed. */
  actual: Map<number, ListChange>;
  /** Adds the case expects, held for the user (absent means none). */
  expectedAdds?: Map<number, ListChange>;
  /** Adds the agent held for the user. */
  actualAdds?: Map<number, ListChange>;
  /** The agent asked a question or held a change for confirmation. */
  asked: boolean;
  reply: string;
  error: string | null;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number | null;
}

export interface CaseScore {
  correct: boolean;
  /** Committed writes that shouldn't have happened, or wrote the wrong values. */
  wrongWrites: number;
  /** All committed writes (one per anime). */
  totalWrites: number;
  /** Expected writes that didn't happen (or happened with wrong values). */
  missedWrites: number;
  /** Held adds that weren't expected, or would add the wrong values. Never written. */
  wrongAdds: number;
  /** Held adds (one per anime). */
  totalAdds: number;
}

/**
 * A case is correct when the committed writes are exactly the expected ones (same anime, same
 * field values, nothing extra), the held adds likewise, and, if a question was expected, the
 * agent asked.
 */
export function scoreCase(run: CaseRun): CaseScore {
  const expectedAdds = run.expectedAdds ?? new Map<number, ListChange>();
  const actualAdds = run.actualAdds ?? new Map<number, ListChange>();
  let wrongAdds = 0;
  for (const [animeId, change] of actualAdds) {
    if (!sameChange(expectedAdds.get(animeId), change)) wrongAdds++;
  }
  const addsRight =
    wrongAdds === 0 &&
    [...expectedAdds].every(([animeId, change]) => sameChange(actualAdds.get(animeId), change));
  let wrongWrites = 0;
  for (const [animeId, change] of run.actual) {
    if (!sameChange(run.expected.get(animeId), change)) wrongWrites++;
  }
  let missedWrites = 0;
  for (const [animeId, change] of run.expected) {
    if (!sameChange(run.actual.get(animeId), change)) missedWrites++;
  }
  const writesRight = wrongWrites === 0 && missedWrites === 0;
  return {
    correct: writesRight && addsRight && run.error === null && (!run.expectClarify || run.asked),
    wrongWrites,
    totalWrites: run.actual.size,
    missedWrites,
    wrongAdds,
    totalAdds: actualAdds.size,
  };
}

function sameChange(a: ListChange | undefined, b: ListChange | undefined): boolean {
  if (!a || !b) return false;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]) as Set<keyof ListChange>;
  return [...keys].every((key) => a[key] === b[key]);
}

export interface Metrics {
  cases: number;
  /** Share of cases handled exactly right: the headline number. */
  updateAccuracy: number;
  /** Wrong writes / all committed writes. */
  wrongWriteRate: number;
  wrongWrites: number;
  totalWrites: number;
  /** Held adds that weren't expected or had the wrong values, of all held adds. */
  wrongAdds: number;
  totalAdds: number;
  /** Of the cases where the agent asked, the share where asking was expected. */
  clarificationPrecision: number | null;
  /** Of the cases where asking was expected, the share where it asked. */
  clarificationRecall: number | null;
  medianLatencyMs: number;
  p90LatencyMs: number;
  /** Median over cases that were expected to write, i.e. message to confirmed write. */
  medianWriteLatencyMs: number | null;
  /** Mean model cost per case that was expected to write (null if any price is unknown). */
  costPerUpdateUsd: number | null;
  errors: number;
  inputTokens: number;
  outputTokens: number;
}

export function aggregate(runs: CaseRun[]): Metrics {
  const scores = runs.map(scoreCase);
  const asked = runs.filter((r) => r.asked);
  const expectedAsk = runs.filter((r) => r.expectClarify);
  const writeCases = runs.filter((r) => r.expected.size > 0);
  const totalWrites = scores.reduce((n, s) => n + s.totalWrites, 0);
  const wrongWrites = scores.reduce((n, s) => n + s.wrongWrites, 0);
  const costs = writeCases.map((r) => r.costUsd);

  return {
    cases: runs.length,
    updateAccuracy: ratio(scores.filter((s) => s.correct).length, runs.length) ?? 0,
    wrongWriteRate: ratio(wrongWrites, totalWrites) ?? 0,
    wrongWrites,
    totalWrites,
    wrongAdds: scores.reduce((n, s) => n + s.wrongAdds, 0),
    totalAdds: scores.reduce((n, s) => n + s.totalAdds, 0),
    clarificationPrecision: ratio(asked.filter((r) => r.expectClarify).length, asked.length),
    clarificationRecall: ratio(expectedAsk.filter((r) => r.asked).length, expectedAsk.length),
    medianLatencyMs:
      percentile(
        runs.map((r) => r.latencyMs),
        0.5,
      ) ?? 0,
    p90LatencyMs:
      percentile(
        runs.map((r) => r.latencyMs),
        0.9,
      ) ?? 0,
    medianWriteLatencyMs: percentile(
      writeCases.map((r) => r.latencyMs),
      0.5,
    ),
    costPerUpdateUsd:
      costs.length === 0 || costs.some((c) => c === null)
        ? null
        : (costs as number[]).reduce((a, b) => a + b, 0) / costs.length,
    errors: runs.filter((r) => r.error !== null).length,
    inputTokens: runs.reduce((n, r) => n + r.inputTokens, 0),
    outputTokens: runs.reduce((n, r) => n + r.outputTokens, 0),
  };
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}

/** Nearest-rank percentile. */
export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))] ?? null;
}
