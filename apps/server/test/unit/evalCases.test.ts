import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { loadCases } from "../../eval/src/cases.js";
import { loadSnapshot, type Snapshot } from "../../eval/src/snapshot.js";

const snapshot: Snapshot = {
  name: "test",
  description: "unit test",
  source: "synthetic",
  exportedAt: "2026-09-30T00:00:00.000Z",
  entries: [
    {
      id: 1,
      title: "Kusuriya no Hitorigoto",
      titleEn: "The Apothecary Diaries",
      titleJa: "薬屋のひとりごと",
      synonyms: ["Drugstore Soliloquy"],
      mediaType: "tv",
      numEpisodes: 24,
      status: "watching",
      episodesWatched: 6,
      isRewatching: false,
      airingStatus: "finished_airing",
    },
    {
      id: 2,
      title: "Shared Name",
      titleEn: null,
      titleJa: null,
      synonyms: [],
      mediaType: "tv",
      numEpisodes: 12,
      status: "plan_to_watch",
      episodesWatched: 0,
      isRewatching: false,
      airingStatus: "finished_airing",
    },
    {
      id: 3,
      title: "Shared Name",
      titleEn: null,
      titleJa: null,
      synonyms: [],
      mediaType: "movie",
      numEpisodes: 1,
      status: "plan_to_watch",
      episodesWatched: 0,
      isRewatching: false,
      airingStatus: "finished_airing",
    },
    {
      id: 4,
      title: "Upcoming Sequel",
      titleEn: null,
      titleJa: null,
      synonyms: [],
      mediaType: "tv",
      numEpisodes: null,
      status: "watching",
      episodesWatched: 0,
      isRewatching: false,
      airingStatus: "not_yet_aired",
    },
  ],
};

let dir: string;

function load(files: Record<string, string>) {
  dir = mkdtempSync(path.join(tmpdir(), "kurisu-cases-"));
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(path.join(dir, name), content);
  }
  return loadCases(`${dir}${path.sep}`, () => snapshot);
}

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const header = "snapshot: test\ncases:\n";

describe("loadCases", () => {
  it("resolves any title form and normalizes the expected change", () => {
    const result = load({
      "a.yaml": `${header}
  - id: by-romaji
    message: m
    expect: { writes: [{ anime: "kusuriya no hitorigoto", episodes_watched: 7 }] }
  - id: by-english
    message: m
    expect: { writes: [{ anime: "The Apothecary Diaries", episodes_watched: 24 }] }
  - id: by-japanese-and-id
    message: m
    expect: { writes: [{ anime: "薬屋のひとりごと", score: 9 }, { anime: 2, episodes_watched: 1 }] }
`,
    });

    expect(result.errors).toEqual([]);
    const changes = Object.fromEntries(
      result.cases.map((c) => [c.case.id, Object.fromEntries(c.expectedChanges)]),
    );
    expect(changes).toEqual({
      "by-romaji": { 1: { episodesWatched: 7 } },
      "by-english": { 1: { episodesWatched: 24, status: "completed" } },
      "by-japanese-and-id": { 1: { score: 9 }, 2: { episodesWatched: 1, status: "watching" } },
    });
  });

  it("reports titles that match several entries, or none, with suggestions", () => {
    const result = load({
      "a.yaml": `${header}
  - id: ambiguous-title
    message: m
    expect: { writes: [{ anime: "Shared Name", episodes_watched: 1 }] }
  - id: typo
    message: m
    expect: { writes: [{ anime: "Apothecary Diary", episodes_watched: 7 }] }
`,
    });

    expect(result.cases).toEqual([]);
    expect(result.errors.map((e) => [e.caseId, e.message])).toEqual([
      ["ambiguous-title", expect.stringMatching(/matches several entries.*id 2.*id 3.*MAL id/)],
      [
        "typo",
        expect.stringMatching(/isn't in the snapshot\. Did you mean: Kusuriya no Hitorigoto/),
      ],
    ]);
  });

  it("catches out-of-range values and duplicate ids across files", () => {
    const result = load({
      "a.yaml": `${header}
  - id: too-far
    message: m
    expect: { writes: [{ anime: 1, episodes_watched: 30 }] }
`,
      "b.yaml": `${header}
  - id: too-far
    message: m
    expect: { clarify: true }
`,
    });

    expect(result.errors.map((e) => e.message)).toEqual([
      "1: episodes_watched is more than the show's 24 episodes.",
      "duplicate case id (also in a.yaml)",
    ]);
  });

  it("points schema errors at the case id", () => {
    const result = load({
      "a.yaml": `${header}
  - id: missing-field
    message: m
    expect: { writes: [{ anime: 1 }] }
  - id: Bad_ID
    message: m
    expect: { clarify: true }
`,
    });

    expect(result.errors.map((e) => e.message)).toEqual([
      expect.stringMatching(
        /^case #1 \(missing-field\) expect\.writes\.0: a write needs at least one/,
      ),
      expect.stringMatching(/^case #2 \(Bad_ID\) id: use lowercase/),
    ]);
  });

  it("warns about writes that change nothing and untagged no-action cases", () => {
    const result = load({
      "a.yaml": `${header}
  - id: no-op
    message: m
    expect: { writes: [{ anime: 1, episodes_watched: 6 }], clarify: true }
  - id: nothing
    message: m
    expect: {}
`,
    });

    expect(result.errors).toEqual([]);
    expect(result.warnings.map((w) => [w.caseId, w.message])).toEqual([
      ["no-op", expect.stringMatching(/changes nothing/)],
      ["nothing", expect.stringMatching(/tagging it "no-action"/)],
    ]);
  });

  it("accepts earlier turns and rejects a malformed one", () => {
    // Separate files: one invalid case rejects its whole file.
    const result = load({
      "a.yaml": `${header}
  - id: with-history
    message: "one more"
    history:
      - { role: user, content: "watched ep 6 of apothecary" }
      - { role: assistant, content: "Updated it." }
    expect: { writes: [{ anime: 1, episodes_watched: 7 }] }
`,
      "b.yaml": `${header}
  - id: bad-history
    message: m
    history: [{ role: system, content: "x" }]
    expect: { clarify: true }
`,
    });

    expect(result.cases.map((c) => [c.case.id, c.case.history.length])).toEqual([
      ["with-history", 2],
    ]);
    expect(result.errors.map((e) => e.message)).toEqual([
      expect.stringMatching(/^case #1 \(bad-history\) history\.0\.role/),
    ]);
  });

  it("warns when a case expects progress on a show that hasn't aired", () => {
    const result = load({
      "a.yaml": `${header}
  - id: early-progress
    message: m
    expect: { writes: [{ anime: "Upcoming Sequel", episodes_watched: 1 }] }
  - id: early-drop
    message: m
    expect: { writes: [{ anime: "Upcoming Sequel", status: dropped }] }
`,
    });

    expect(result.errors).toEqual([]);
    expect(result.warnings.map((w) => [w.caseId, w.message])).toEqual([
      ["early-progress", expect.stringMatching(/hasn't aired yet.*clarify: true/)],
    ]);
  });

  it("reports invalid YAML without crashing", () => {
    const result = load({ "a.yaml": "snapshot: test\ncases: [\n" });
    expect(result.errors[0]?.message).toMatch(/not valid YAML/);
  });
});

describe("loadSnapshot", () => {
  it("loads snapshots exported before airing status existed, with it unknown", () => {
    dir = mkdtempSync(path.join(tmpdir(), "kurisu-snapshot-"));
    const oldEntry = Object.fromEntries(
      Object.entries(snapshot.entries[0] ?? {}).filter(([key]) => key !== "airingStatus"),
    );
    writeFileSync(
      path.join(dir, "old.json"),
      JSON.stringify({ ...snapshot, name: "old", entries: [oldEntry] }),
    );

    expect(loadSnapshot("old", `${dir}${path.sep}`).entries[0]?.airingStatus).toBeNull();
  });
});

describe("committed snapshots and cases", () => {
  it("the example cases validate against the example snapshot", () => {
    const result = loadCases();
    expect(result.errors).toEqual([]);
    expect(loadSnapshot("examples").entries.length).toBeGreaterThan(0);
  });
});
