import type { ListChange } from "../../src/writes/normalize.js";
import type { ExpectedRow, ImportGroup } from "./importCases.js";

/** A review row the import made, as the eval compares it. */
export interface ProducedRow {
  line: number;
  position: number;
  group: ImportGroup;
  animeId: number | null;
  candidates: number[];
  change: ListChange | null;
  /** Pre-checked: one Import tap would write it. */
  checked: boolean;
  said: string;
}

export interface RowVerdict {
  line: number;
  expected: ExpectedRow | null;
  produced: ProducedRow | null;
  right: boolean;
  /** Why it's wrong, in words. */
  why: string | null;
  /** Pre-checked and wrong: the mistake that matters most. */
  wrongPrechecked: boolean;
}

const ASKS: ImportGroup[] = ["which_one", "disagree"];

/** Whether every field the case gives is in the change with that value. */
function changeFits(expected: ListChange, actual: ListChange | null): boolean {
  if (!actual) return false;
  return (Object.keys(expected) as (keyof ListChange)[]).every(
    (key) => actual[key] === expected[key],
  );
}

function compare(expected: ExpectedRow, produced: ProducedRow): string | null {
  if (expected.group !== produced.group) {
    return `${produced.group}, expected ${expected.group}`;
  }
  if (expected.animeId !== null) {
    if (expected.group === "which_one") {
      if (!produced.candidates.includes(expected.animeId)) {
        return `the right show (${String(expected.animeId)}) isn't among the choices`;
      }
    } else if (produced.animeId !== expected.animeId) {
      return `matched ${String(produced.animeId)}, expected ${String(expected.animeId)}`;
    }
  }
  if (expected.change && !changeFits(expected.change, produced.change)) {
    return `change ${JSON.stringify(produced.change)}, expected ${JSON.stringify(expected.change)}`;
  }
  return null;
}

/**
 * Lines up what the import made with what the case expects, line by line and in order on each
 * line. A line the case doesn't list should come back as not a show.
 */
export function scoreImport(
  expected: ExpectedRow[],
  produced: ProducedRow[],
  lines: number[],
): RowVerdict[] {
  const verdicts: RowVerdict[] = [];
  for (const line of lines) {
    const listed = expected.filter((r) => r.line === line);
    const wanted: ExpectedRow[] =
      listed.length > 0 ? listed : [{ line, group: "not_a_show", animeId: null, change: null }];
    const made = produced.filter((r) => r.line === line).sort((a, b) => a.position - b.position);
    for (let i = 0; i < Math.max(wanted.length, made.length); i++) {
      const exp = wanted[i] ?? null;
      const prod = made[i] ?? null;
      const why = !prod ? "no row for it" : !exp ? "an extra row" : compare(exp, prod);
      verdicts.push({
        line,
        expected: exp,
        produced: prod,
        right: why === null,
        why,
        wrongPrechecked: why !== null && prod?.checked === true,
      });
    }
  }
  return verdicts;
}

export interface ImportRun {
  caseId: string;
  file: string;
  tags: string[];
  notes: string;
  verdicts: RowVerdict[];
  error: string | null;
  latencyMs: number;
  costUsd: number | null;
  inputTokens: number;
  outputTokens: number;
}

export interface ImportMetrics {
  cases: number;
  casesRight: number;
  rows: number;
  rowsRight: number;
  /** Rows one Import tap would have written wrongly. Must be 0. */
  wrongPrechecked: number;
  prechecked: number;
  /** "?" rows (which one, disagree) made, and how many the case expected. */
  askPrecision: { right: number; made: number };
  askRecall: { found: number; expected: number };
  medianLatencyMs: number;
  costPerCaseUsd: number | null;
  errors: number;
}

export function aggregateImport(runs: ImportRun[]): ImportMetrics {
  const verdicts = runs.flatMap((r) => r.verdicts);
  const latencies = runs.map((r) => r.latencyMs).sort((a, b) => a - b);
  const costs = runs.map((r) => r.costUsd);
  const known = costs.filter((c): c is number => c !== null);
  const isAsk = (group: ImportGroup | undefined) => group !== undefined && ASKS.includes(group);
  return {
    cases: runs.length,
    casesRight: runs.filter((r) => r.error === null && r.verdicts.every((v) => v.right)).length,
    rows: verdicts.length,
    rowsRight: verdicts.filter((v) => v.right).length,
    wrongPrechecked: verdicts.filter((v) => v.wrongPrechecked).length,
    prechecked: verdicts.filter((v) => v.produced?.checked === true).length,
    askPrecision: {
      made: verdicts.filter((v) => isAsk(v.produced?.group)).length,
      right: verdicts.filter((v) => isAsk(v.produced?.group) && isAsk(v.expected?.group)).length,
    },
    askRecall: {
      expected: verdicts.filter((v) => isAsk(v.expected?.group)).length,
      found: verdicts.filter((v) => isAsk(v.expected?.group) && isAsk(v.produced?.group)).length,
    },
    medianLatencyMs: latencies[Math.floor((latencies.length - 1) / 2)] ?? 0,
    costPerCaseUsd:
      known.length > 0 && known.length === costs.length
        ? known.reduce((sum, c) => sum + c, 0) / known.length
        : null,
    errors: runs.filter((r) => r.error !== null).length,
  };
}
