import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { loadRagCases } from "../../eval/src/ragCases.js";
import { aggregateRag, scoreRagRun, type RagRun } from "../../eval/src/ragScore.js";
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
  entries: [
    entry(1, "Mushishi", "plan_to_watch"),
    entry(2, "Monster", "dropped"),
    entry(3, "Monster Musume", "completed"),
  ],
};

let dir: string | null = null;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = null;
});

function load(yaml: string) {
  dir = mkdtempSync(path.join(tmpdir(), "rag-cases-"));
  writeFileSync(path.join(dir, "rag-mine.yaml"), yaml);
  return loadRagCases(`${dir}${path.sep}`, () => snapshot);
}

describe("RAG cases", () => {
  it("resolves sources to MAL ids and knows which questions should be declined", () => {
    const { cases, errors } = load(`snapshot: my-list
cases:
  - id: dropped-monster
    question: did I drop monster?
    expect:
      sources: [2]
      facts: [You dropped Monster]
  - id: not-on-list
    question: did I like evangelion?
    expect:
      not_on_list: true
`);
    expect(errors).toEqual([]);
    expect(cases.map((c) => [c.case.id, c.sources, c.declines])).toEqual([
      ["dropped-monster", [2], false],
      ["not-on-list", [], true],
    ]);
  });

  it("refuses cases without facts or sources, ambiguous titles, and facts on declined ones", () => {
    const { cases, errors } = load(`snapshot: my-list
cases:
  - id: no-facts
    question: what about mushishi?
    expect:
      sources: [Mushishi]
  - id: no-sources
    question: what did I drop?
    expect:
      facts: [You dropped Monster]
  - id: unknown-title
    question: what about frieren?
    expect:
      sources: [Frieren]
      facts: [It's on your list]
  - id: declined-with-facts
    question: what score did I give mushishi?
    expect:
      unanswerable: true
      facts: [You gave it a 9]
`);
    expect(cases).toEqual([]);
    expect(errors.map((e) => e.caseId)).toEqual([
      "no-facts",
      "no-sources",
      "unknown-title",
      "declined-with-facts",
    ]);
  });
});

const run = (fields: Partial<RagRun>): RagRun => ({
  file: "rag-mine.yaml",
  caseId: "a",
  tags: [],
  question: "q",
  sources: [2],
  declines: false,
  facts: ["You dropped Monster"],
  retrieved: [2, 3],
  byMeaning: [3, 2],
  byName: [],
  answer: "You dropped Monster [2].",
  cited: [2],
  strayCitations: [],
  grade: {
    facts: [{ fact: "You dropped Monster", stated: true }],
    claims: [{ claim: "dropped Monster", supported: true }],
    declined: false,
  },
  judgeError: null,
  error: null,
  latencyMs: 100,
  inputTokens: 10,
  outputTokens: 5,
  ...fields,
});

describe("RAG scoring", () => {
  it("counts recall at k, citations, facts and grounding", () => {
    expect(scoreRagRun(run({}), 8)).toMatchObject({
      recall: 1,
      recallByMeaning: 1,
      recallByName: 0,
      citedSources: 1,
      cited: 1,
      grounded: true,
      correct: true,
    });
    // Only the first k count.
    expect(scoreRagRun(run({ retrieved: [3, 2] }), 1).recall).toBe(0);
  });

  it("fails an answer that misses a fact, makes a claim its sources don't, or cites made-up ids", () => {
    const missed = run({
      grade: {
        facts: [{ fact: "You dropped Monster", stated: false }],
        claims: [],
        declined: false,
      },
    });
    expect(scoreRagRun(missed, 8).correct).toBe(false);
    const unsupported = run({
      grade: {
        facts: [{ fact: "You dropped Monster", stated: true }],
        claims: [{ claim: "you rated it 9", supported: false }],
        declined: false,
      },
    });
    expect(scoreRagRun(unsupported, 8)).toMatchObject({ correct: true, grounded: false });
    expect(scoreRagRun(run({ strayCitations: [99] }), 8).grounded).toBe(false);
  });

  it("wants a decline exactly when the case says the list can't answer", () => {
    const declined = { facts: [], claims: [], declined: true };
    expect(scoreRagRun(run({ declines: true, facts: [], grade: declined }), 8).correct).toBe(true);
    expect(scoreRagRun(run({ grade: { ...declined, facts: [] } }), 8).correct).toBe(false);
  });

  it("adds up citation precision and facts over all answers", () => {
    const scored = [run({}), run({ cited: [2, 3], caseId: "b" })].map((r) => ({
      run: r,
      score: scoreRagRun(r, 8),
    }));
    expect(aggregateRag(scored, 8)).toMatchObject({
      cases: 2,
      recallAtK: 1,
      citationPrecision: 2 / 3,
      factsStated: 1,
      groundedRate: 1,
      correctRate: 1,
    });
  });
});
