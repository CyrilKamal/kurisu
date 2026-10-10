import type { Grade } from "./ragJudge.js";

/** One RAG case's run, as the report keeps it. */
export interface RagRun {
  file: string;
  caseId: string;
  tags: string[];
  question: string;
  sources: number[];
  declines: boolean;
  facts: string[];
  /** The fused top k handed to the model, then each channel's own order. */
  retrieved: number[];
  byMeaning: number[];
  byName: number[];
  answer: string;
  cited: number[];
  strayCitations: number[];
  grade: Grade | null;
  judgeError: string | null;
  error: string | null;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
}

export interface RagScore {
  /** Share of the sources among the k documents retrieved; null without sources. */
  recall: number | null;
  recallByMeaning: number | null;
  recallByName: number | null;
  /** Cited documents that are sources; counts, since few answers cite many. */
  citedSources: number;
  cited: number;
  factsStated: number;
  facts: number;
  claimsSupported: number;
  claims: number;
  /** Every claim supported by its citations, and no made-up citation. */
  grounded: boolean | null;
  /** Declined when it should, and otherwise stated every fact without declining. */
  correct: boolean | null;
}

export function scoreRagRun(run: RagRun, k: number): RagScore {
  const share = (found: number[]) =>
    run.sources.length === 0
      ? null
      : run.sources.filter((id) => found.includes(id)).length / run.sources.length;
  const grade = run.grade;
  const claimsSupported = grade?.claims.filter((c) => c.supported).length ?? 0;
  return {
    recall: share(run.retrieved.slice(0, k)),
    recallByMeaning: share(run.byMeaning.slice(0, k)),
    recallByName: share(run.byName.slice(0, k)),
    citedSources: run.cited.filter((id) => run.sources.includes(id)).length,
    cited: run.cited.length,
    factsStated: grade?.facts.filter((f) => f.stated).length ?? 0,
    facts: run.facts.length,
    claimsSupported,
    claims: grade?.claims.length ?? 0,
    grounded: grade
      ? claimsSupported === grade.claims.length && run.strayCitations.length === 0
      : null,
    correct: grade
      ? run.declines
        ? grade.declined
        : !grade.declined &&
          grade.facts.length >= run.facts.length &&
          grade.facts.every((f) => f.stated)
      : null,
  };
}

export interface RagMetrics {
  cases: number;
  k: number;
  /** Mean over cases with sources. */
  recallAtK: number | null;
  recallByMeaning: number | null;
  recallByName: number | null;
  /** Cited documents that are sources, over all citations. */
  citationPrecision: number | null;
  strayCitations: number;
  /** Facts stated, over all expected facts. */
  factsStated: number | null;
  /** Claims supported by their citations, over all claims. */
  claimsSupported: number | null;
  /** Answers with every claim supported, over graded answers. */
  groundedRate: number | null;
  correctRate: number | null;
  judgeErrors: number;
  errors: number;
  medianLatencyMs: number;
  inputTokens: number;
  outputTokens: number;
}

const mean = (xs: number[]) => (xs.length === 0 ? null : xs.reduce((s, x) => s + x, 0) / xs.length);
const ratio = (n: number, d: number) => (d === 0 ? null : n / d);
const rate = (xs: (boolean | null)[]) => {
  const graded = xs.filter((x): x is boolean => x !== null);
  return ratio(graded.filter(Boolean).length, graded.length);
};

export function aggregateRag(scored: { run: RagRun; score: RagScore }[], k: number): RagMetrics {
  const sum = (pick: (s: RagScore) => number) => scored.reduce((n, x) => n + pick(x.score), 0);
  const recalls = (pick: (s: RagScore) => number | null) =>
    mean(scored.map((x) => pick(x.score)).filter((r): r is number => r !== null));
  const latencies = scored.map((x) => x.run.latencyMs).sort((a, b) => a - b);
  return {
    cases: scored.length,
    k,
    recallAtK: recalls((s) => s.recall),
    recallByMeaning: recalls((s) => s.recallByMeaning),
    recallByName: recalls((s) => s.recallByName),
    citationPrecision: ratio(
      sum((s) => s.citedSources),
      sum((s) => s.cited),
    ),
    strayCitations: scored.reduce((n, x) => n + x.run.strayCitations.length, 0),
    factsStated: ratio(
      sum((s) => s.factsStated),
      sum((s) => s.facts),
    ),
    claimsSupported: ratio(
      sum((s) => s.claimsSupported),
      sum((s) => s.claims),
    ),
    groundedRate: rate(scored.map((x) => x.score.grounded)),
    correctRate: rate(scored.map((x) => x.score.correct)),
    judgeErrors: scored.filter((x) => x.run.judgeError !== null).length,
    errors: scored.filter((x) => x.run.error !== null).length,
    medianLatencyMs: latencies[Math.floor(latencies.length / 2)] ?? 0,
    inputTokens: scored.reduce((n, x) => n + x.run.inputTokens, 0),
    outputTokens: scored.reduce((n, x) => n + x.run.outputTokens, 0),
  };
}
