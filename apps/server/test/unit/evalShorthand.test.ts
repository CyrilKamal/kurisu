import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { loadCases } from "../../eval/src/cases.js";
import { lookUp } from "../../eval/src/lookup.js";
import { parseShorthand } from "../../eval/src/shorthand.js";
import type { Snapshot, SnapshotEntry } from "../../eval/src/snapshot.js";

function entry(id: number, title: string, extra: Partial<SnapshotEntry> = {}): SnapshotEntry {
  return {
    id,
    title,
    titleEn: null,
    titleJa: null,
    synonyms: [],
    mediaType: "tv",
    numEpisodes: 12,
    status: "watching",
    episodesWatched: 3,
    isRewatching: false,
    airingStatus: "finished_airing",
    ...extra,
  };
}

const snapshot: Snapshot = {
  name: "my-list",
  description: "unit test",
  source: "synthetic",
  exportedAt: "2026-10-02T00:00:00.000Z",
  entries: [
    entry(1, "Alpha Show", { synonyms: ["AS"], titleEn: "The Alpha" }),
    entry(2, "Kaiju #8 Fixture", { status: "plan_to_watch", episodesWatched: 0 }),
    entry(3, "Re:Fixture", { status: "completed", episodesWatched: 12 }),
    entry(4, "Shared", { status: "completed", episodesWatched: 12 }),
    entry(5, "Shared", { mediaType: "movie", numEpisodes: 1, episodesWatched: 0 }),
  ],
};

describe("parseShorthand", () => {
  it("reads writes, ask, none, tags, notes and history", () => {
    const parsed = parseShorthand(
      [
        "// comment",
        "tags: plain",
        "AS two more => Alpha Show: ep 5  #relative #nickname",
        "started kaiju 8 and the shared one => Kaiju #8 Fixture: ep 1; ask // a note",
        "what now? => none",
        "",
        "user: drop the shared one",
        "bot: Which one, the show or the movie?",
        "the movie => 5: dropped, score 3",
        "tags:",
        "rewatching re:fixture => Re:Fixture: rewatching, ep 1, watching",
      ].join("\n"),
      "Batch 1",
    );

    expect(parsed.errors).toEqual([]);
    expect(parsed.snapshot).toBe("my-list");
    expect(parsed.cases).toEqual([
      {
        id: "batch-1-as-two-more",
        message: "AS two more",
        history: [],
        tags: ["plain", "relative", "nickname"],
        expect: { writes: [{ anime: "Alpha Show", episodes_watched: 5 }], clarify: false },
      },
      {
        id: "batch-1-started-kaiju-8-and-the-shared",
        message: "started kaiju 8 and the shared one",
        history: [],
        tags: ["plain"],
        notes: "a note",
        expect: { writes: [{ anime: "Kaiju #8 Fixture", episodes_watched: 1 }], clarify: true },
      },
      {
        id: "batch-1-what-now",
        message: "what now?",
        history: [],
        tags: ["plain"],
        expect: { writes: [], clarify: false },
      },
      {
        id: "batch-1-the-movie",
        message: "the movie",
        history: [
          { role: "user", content: "drop the shared one" },
          { role: "assistant", content: "Which one, the show or the movie?" },
        ],
        tags: ["plain"],
        expect: { writes: [{ anime: 5, status: "dropped", score: 3 }], clarify: false },
      },
      {
        id: "batch-1-rewatching-re-fixture",
        message: "rewatching re:fixture",
        history: [],
        tags: [],
        expect: {
          writes: [
            { anime: "Re:Fixture", is_rewatching: true, episodes_watched: 1, status: "watching" },
          ],
          clarify: false,
        },
      },
    ]);
    expect(parsed.lineOf.get("batch-1-the-movie")).toBe(9);
  });

  it("explains malformed lines by line number and keeps the rest", () => {
    const parsed = parseShorthand(
      [
        "no arrow here",
        "x => Alpha Show",
        "x => Alpha Show: ep five",
        "x => Alpha Show: ep 2, ep 3",
        "x => none; ask",
        "x =>",
        "fine => none",
        "fine => none",
      ].join("\n"),
      "b",
    );

    expect(parsed.errors.map((e) => [e.line, e.message])).toEqual([
      [1, expect.stringMatching(/expected "<message> => <what should happen>"/)],
      [2, expect.stringMatching(/<title or MAL id>: <fields>/)],
      [3, expect.stringMatching(/couldn't read "ep five"/)],
      [4, expect.stringMatching(/sets episodes_watched a second time/)],
      [5, expect.stringMatching(/"none" means nothing should happen/)],
      [6, expect.stringMatching(/say what should happen/)],
    ]);
    expect(parsed.cases.map((c) => c.id)).toEqual(["b-fine", "b-fine-2"]);
  });
});

describe("loadCases with shorthand files", () => {
  let dir: string;
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function load(files: Record<string, string>) {
    dir = mkdtempSync(path.join(tmpdir(), "kurisu-shorthand-"));
    for (const [name, content] of Object.entries(files)) {
      writeFileSync(path.join(dir, name), content);
    }
    return loadCases(`${dir}${path.sep}`, () => snapshot);
  }

  it("validates .txt cases like YAML ones, pointing problems at the line", () => {
    const result = load({
      "batch.txt": [
        "AS ep 12 => Alpha Show: ep 12",
        "the shared one => Shared: dropped",
        "",
        "beta => Bravo Show: ep 1",
      ].join("\n"),
      "other.yaml":
        "snapshot: my-list\ncases:\n  - id: y\n    message: m\n    expect: { clarify: true }\n",
    });

    expect(result.cases.map((c) => [c.case.id, Object.fromEntries(c.expectedChanges)])).toEqual([
      ["batch-as-ep-12", { 1: { episodesWatched: 12, status: "completed" } }],
      ["y", {}],
    ]);
    expect(result.errors.map((e) => [e.file, e.line, e.message])).toEqual([
      ["batch.txt", 2, expect.stringMatching(/matches several entries.*Use the MAL id/)],
      ["batch.txt", 4, expect.stringMatching(/isn't in the snapshot/)],
    ]);
  });

  it("reports an empty shorthand file", () => {
    expect(load({ "empty.txt": "// nothing yet\n" }).errors).toEqual([
      { file: "empty.txt", message: "no cases yet." },
    ]);
  });
});

describe("lookUp", () => {
  it("finds entries by any name, best match first, and says how to name them in a case", () => {
    const hits = lookUp(snapshot, "alpha");
    expect(hits.map((h) => [h.entry.id, h.caseName])).toEqual([[1, "Alpha Show"]]);
    expect(lookUp(snapshot, "as").map((h) => h.entry.id)).toEqual([1]);
    expect(lookUp(snapshot, "shared").map((h) => h.caseName)).toEqual(["4", "5"]);
  });

  it("filters by list status and airing status", () => {
    expect(lookUp(snapshot, "", { status: "plan_to_watch" }).map((h) => h.entry.id)).toEqual([2]);
    expect(lookUp(snapshot, "", { airing: "not_yet_aired" })).toEqual([]);
  });
});
