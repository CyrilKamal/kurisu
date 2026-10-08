import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { CatalogFreeze } from "../../eval/src/catalog.js";
import { loadImportCases, type ExpectedRow } from "../../eval/src/importCases.js";
import { aggregateImport, scoreImport, type ProducedRow } from "../../eval/src/importScore.js";
import type { Snapshot } from "../../eval/src/snapshot.js";

const snapshot: Snapshot = {
  name: "my-list",
  description: "unit test",
  source: "synthetic",
  exportedAt: "2026-10-01T00:00:00.000Z",
  entries: [
    {
      id: 1,
      title: "Kusuriya no Hitorigoto",
      titleEn: null,
      titleJa: null,
      synonyms: [],
      mediaType: "tv",
      numEpisodes: 24,
      status: "watching",
      episodesWatched: 0,
      isRewatching: false,
      airingStatus: "finished_airing",
    },
  ],
};

const catalog: CatalogFreeze = {
  description: "test",
  source: "anilist",
  searches: [
    {
      query: "perfect blue",
      frozenAt: "2026-10-06T00:00:00.000Z",
      shows: [
        {
          anilistId: 437,
          malId: 437,
          title: "PERFECT BLUE",
          titleEn: null,
          titleJa: null,
          synonyms: [],
          format: "MOVIE",
          status: "FINISHED",
          episodes: 1,
          duration: 81,
          coverUrl: null,
          startDate: "1998",
        },
      ],
    },
  ],
};

let dir: string | null = null;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = null;
});

function load(content: string) {
  dir = mkdtempSync(path.join(tmpdir(), "kurisu-import-cases-"));
  writeFileSync(path.join(dir, "import-test.yaml"), content);
  return loadImportCases(catalog, `${dir}${path.sep}`, () => snapshot);
}

describe("loadImportCases", () => {
  it("resolves shows on the list and in the frozen catalog", () => {
    const result = load(`snapshot: my-list
cases:
  - id: imp
    notes: |
      kusuriya ep 3
      perfect blue 10/10
    expect:
      - line: 1
        group: update
        anime: Kusuriya no Hitorigoto
        change: { episodes_watched: 3 }
      - line: 2
        group: add
        anime: PERFECT BLUE
`);
    expect(result.errors).toEqual([]);
    expect(result.cases[0]?.rows).toEqual([
      { line: 1, group: "update", animeId: 1, change: { episodesWatched: 3 } },
      { line: 2, group: "add", animeId: 437, change: null },
    ]);
  });

  it("rejects unknown shows, missing shows and lines past the end", () => {
    const result = load(`snapshot: my-list
cases:
  - id: imp
    notes: one line
    expect:
      - line: 1
        group: add
        anime: Nothing Like This
      - line: 1
        group: update
      - line: 5
        group: not_a_show
`);
    expect(result.errors.map((e) => e.message)).toEqual([
      'expect[0]: "Nothing Like This" isn\'t on the list or in the frozen catalog (pnpm eval:lookup, or pnpm eval:catalog "Nothing Like This").',
      "expect[1]: a update row needs anime.",
      "expect[2]: line 5 is past the notes' end.",
    ]);
  });
});

function produced(fields: Partial<ProducedRow> & { line: number }): ProducedRow {
  return {
    position: 0,
    group: "not_a_show",
    animeId: null,
    candidates: [],
    change: null,
    checked: false,
    said: "",
    ...fields,
  };
}

describe("scoreImport", () => {
  const expected: ExpectedRow[] = [
    { line: 2, group: "update", animeId: 1, change: { episodesWatched: 3 } },
    { line: 3, group: "which_one", animeId: 7, change: null },
  ];

  it("lines rows up, treating unlisted lines as not shows", () => {
    const verdicts = scoreImport(
      expected,
      [
        produced({ line: 1 }),
        produced({
          line: 2,
          group: "update",
          animeId: 1,
          change: { episodesWatched: 3 },
          checked: true,
        }),
        produced({ line: 3, group: "which_one", candidates: [5, 7] }),
      ],
      [1, 2, 3],
    );
    expect(verdicts.map((v) => v.right)).toEqual([true, true, true]);
  });

  it("flags a wrong row that one tap would write", () => {
    const verdicts = scoreImport(
      expected,
      [
        produced({ line: 1, group: "add", animeId: 9, checked: true }),
        produced({
          line: 2,
          group: "update",
          animeId: 2,
          change: { episodesWatched: 3 },
          checked: true,
        }),
        produced({ line: 3, group: "which_one", candidates: [5] }),
      ],
      [1, 2, 3],
    );
    expect(verdicts.map((v) => [v.right, v.wrongPrechecked, v.why])).toEqual([
      [false, true, "add, expected not_a_show"],
      [false, true, "matched 2, expected 1"],
      [false, false, "the right show (7) isn't among the choices"],
    ]);
    const metrics = aggregateImport([
      {
        caseId: "x",
        file: "f",
        tags: [],
        notes: "",
        verdicts,
        error: null,
        latencyMs: 10,
        costUsd: 0.001,
        inputTokens: 1,
        outputTokens: 1,
      },
    ]);
    expect(metrics).toMatchObject({
      rows: 3,
      rowsRight: 0,
      wrongPrechecked: 2,
      prechecked: 2,
      askPrecision: { made: 1, right: 1 },
      askRecall: { expected: 1, found: 1 },
    });
  });
});
