import { describe, expect, it } from "vitest";

import { decide, groupMatched } from "../../src/import/classify.js";
import { itemsFrom, MAX_IMPORT_LINES, noteLines, parseReport } from "../../src/import/parse.js";
import type { SearchCandidate } from "../../src/list/search.js";
import { MAL_LIST_STATUSES } from "../../src/mal/client.js";
import type { EntryState, RequestedChange } from "../../src/writes/normalize.js";

function entry(fields: Partial<EntryState> = {}): EntryState {
  return {
    status: "watching",
    episodesWatched: 5,
    numEpisodes: 12,
    score: 0,
    isRewatching: false,
    ...fields,
  };
}

describe("groupMatched: a show not on the list", () => {
  it("is an add, pre-checked, to Plan to Watch when the notes give nothing else", () => {
    expect(groupMatched({}, 12, null)).toEqual({
      group: "add",
      malState: null,
      change: { status: "plan_to_watch" },
      note: null,
      checked: true,
    });
  });

  it("adds a show with only a score as Completed (your rule)", () => {
    expect(groupMatched({ score: 10 }, 28, null)).toMatchObject({
      group: "add",
      change: { status: "completed", episodesWatched: 28, score: 10 },
      checked: true,
    });
  });

  it("adds progress as Watching, and can't add past the last episode", () => {
    expect(groupMatched({ episodesWatched: 3 }, 12, null).change).toEqual({
      status: "watching",
      episodesWatched: 3,
    });
    expect(groupMatched({ episodesWatched: 40 }, 28, null)).toMatchObject({
      group: "disagree",
      change: null,
      note: "The notes say ep 40, but it has 28.",
      checked: false,
    });
  });
});

describe("groupMatched: a show on the list", () => {
  it("is up to date when the notes change nothing", () => {
    expect(groupMatched({ episodesWatched: 5 }, 12, entry())).toMatchObject({
      group: "up_to_date",
      change: null,
      checked: false,
    });
  });

  it("is an update, pre-checked, when the notes only move it forward", () => {
    expect(groupMatched({ episodesWatched: 8 }, 12, entry())).toMatchObject({
      group: "update",
      malState: { status: "watching", episodesWatched: 5, score: 0, isRewatching: false },
      change: { episodesWatched: 8 },
      checked: true,
    });
    expect(
      groupMatched({ status: "completed" }, 12, entry({ status: "plan_to_watch" })),
    ).toMatchObject({ group: "update", change: { status: "completed", episodesWatched: 12 } });
    expect(groupMatched({ status: "watching" }, 12, entry({ status: "on_hold" })).group).toBe(
      "update",
    );
    // A score where MAL has none, even on a finished show.
    expect(
      groupMatched({ score: 9 }, 12, entry({ status: "completed", episodesWatched: 12 })),
    ).toMatchObject({ group: "update", change: { score: 9 } });
  });

  it("asks, keeping MAL, when the notes lower progress", () => {
    expect(groupMatched({ episodesWatched: 3 }, 12, entry())).toMatchObject({
      group: "disagree",
      change: { episodesWatched: 3 },
      checked: false,
    });
  });

  it("asks before changing a finished show", () => {
    const finished = entry({ status: "completed", episodesWatched: 12 });
    expect(groupMatched({ status: "dropped" }, 12, finished).group).toBe("disagree");
    expect(groupMatched({ isRewatching: true }, 12, finished).group).toBe("disagree");
  });

  it("asks when the notes contradict the status or the score", () => {
    expect(groupMatched({ status: "dropped" }, 12, entry()).group).toBe("disagree");
    expect(groupMatched({ status: "plan_to_watch" }, 12, entry()).group).toBe("disagree");
    expect(groupMatched({ score: 6 }, 12, entry({ score: 8 })).group).toBe("disagree");
    expect(groupMatched({ score: 8 }, 12, entry({ score: 8 })).group).toBe("up_to_date");
  });

  it("notes numbers that don't fit the show", () => {
    expect(groupMatched({ episodesWatched: 20 }, 12, entry())).toMatchObject({
      group: "disagree",
      change: null,
      note: "The notes say ep 20, but it has 12.",
    });
  });
});

describe("groupMatched: a score with no status means watched (your rule)", () => {
  const planned = entry({ status: "plan_to_watch", episodesWatched: 0, numEpisodes: 74 });

  it("adds it as Completed even when the reading has a stray 0 episodes", () => {
    // "perfect blue 10/10", read with episodes_watched: null (see the parse tests).
    expect(groupMatched({ episodesWatched: 0, score: 10 }, 1, null)).toEqual({
      group: "add",
      malState: null,
      change: { status: "completed", episodesWatched: 1, score: 10 },
      note: null,
      checked: true,
    });
  });

  it("marks a Plan to Watch show on the list Completed, not a scored Plan to Watch", () => {
    for (const notes of [{ score: 9 }, { episodesWatched: 0, score: 9 }]) {
      expect(groupMatched(notes, 74, planned)).toMatchObject({
        group: "update",
        change: { status: "completed", episodesWatched: 74, score: 9 },
        checked: true,
      });
    }
  });

  it("still asks before replacing a score MAL has", () => {
    expect(groupMatched({ score: 9 }, 74, { ...planned, score: 7 })).toMatchObject({
      group: "disagree",
      change: { status: "completed", episodesWatched: 74, score: 9 },
      checked: false,
    });
  });

  it("only scores a show already started", () => {
    expect(groupMatched({ score: 8 }, 12, entry())).toMatchObject({
      group: "update",
      change: { score: 8 },
      checked: true,
    });
  });
});

describe("groupMatched: a reading that contradicts itself", () => {
  const planned = entry({ status: "plan_to_watch", episodesWatched: 0 });

  it("holds Plan to Watch with a score or episodes, with only a note", () => {
    const cases: [RequestedChange, EntryState | null, string][] = [
      [{ status: "plan_to_watch", score: 10 }, null, "but also give a score"],
      [{ status: "plan_to_watch", episodesWatched: 3 }, null, "but also give episodes watched"],
      [{ status: "plan_to_watch", episodesWatched: 3 }, planned, "but also give episodes watched"],
      [{ status: "plan_to_watch", score: 8 }, entry(), "but also give a score"],
    ];
    for (const [notes, onList, why] of cases) {
      const grouped = groupMatched(notes, 12, onList);
      expect(grouped).toMatchObject({ group: "disagree", change: null, checked: false });
      expect(grouped.note).toContain(why);
    }
  });

  it("holds a show the notes say is finished short of its last episode", () => {
    // "finished bocchi the rock 9/10", read with episodes_watched: null, on Plan to Watch at 0.
    expect(
      groupMatched({ status: "completed", episodesWatched: 0, score: 9 }, 12, planned),
    ).toEqual({
      group: "disagree",
      malState: { status: "plan_to_watch", episodesWatched: 0, score: 0, isRewatching: false },
      change: null,
      note: "The notes say finished, but with no episodes watched.",
      checked: false,
    });
    expect(groupMatched({ status: "completed", episodesWatched: 0 }, null, null)).toMatchObject({
      group: "disagree",
      change: null,
      checked: false,
    });
    // "finished X ep 3" could mean up to ep 3.
    for (const onList of [null, planned, entry({ episodesWatched: 2 })]) {
      expect(groupMatched({ status: "completed", episodesWatched: 3 }, 12, onList)).toMatchObject({
        group: "disagree",
        change: null,
        note: "The notes say finished, but at ep 3 of 12.",
        checked: false,
      });
    }
    // All of them, or a show whose length MAL doesn't know, is fine.
    expect(groupMatched({ status: "completed", episodesWatched: 12 }, 12, null).group).toBe("add");
    expect(groupMatched({ status: "completed", episodesWatched: 3 }, null, null).group).toBe("add");
  });

  it("never pre-checks a row that ends Plan to Watch with the notes' score or episodes, or finished short", () => {
    const statuses = [undefined, ...MAL_LIST_STATUSES];
    const entries: (EntryState | null)[] = [
      null,
      ...MAL_LIST_STATUSES.map((status) =>
        entry({
          status,
          episodesWatched: status === "completed" ? 12 : status === "plan_to_watch" ? 0 : 2,
        }),
      ),
    ];
    let prechecked = 0;
    for (const status of statuses) {
      for (const episodesWatched of [undefined, 0, 3]) {
        for (const score of [undefined, 9]) {
          const notes: RequestedChange = {
            ...(status !== undefined && { status }),
            ...(episodesWatched !== undefined && { episodesWatched }),
            ...(score !== undefined && { score }),
          };
          for (const onList of entries) {
            const grouped = groupMatched(notes, 12, onList);
            if (!grouped.checked || !grouped.change) continue;
            prechecked++;
            const after = {
              status: grouped.change.status ?? onList?.status ?? "plan_to_watch",
              episodesWatched: grouped.change.episodesWatched ?? onList?.episodesWatched ?? 0,
            };
            const label = JSON.stringify({ notes, onList: onList?.status ?? null });
            if (after.status === "plan_to_watch") {
              expect(notes.score, label).toBeUndefined();
              expect(after.episodesWatched, label).toBe(0);
            }
            if (after.status === "completed") expect(after.episodesWatched, label).toBe(12);
          }
        }
      }
    }
    // The grid does reach pre-checked rows, so the checks above ran.
    expect(prechecked).toBeGreaterThan(20);
  });
});

function candidate(
  animeId: number,
  fields: Partial<SearchCandidate<"watching" | null>> = {},
): SearchCandidate<"watching" | null> {
  return {
    animeId,
    title: `Show ${String(animeId)}`,
    titleEn: null,
    mediaType: "tv",
    numEpisodes: 12,
    status: null,
    episodesWatched: 0,
    score: 0,
    isRewatching: false,
    airingStatus: "finished_airing",
    matchScore: 0.9,
    matchedName: `Show ${String(animeId)}`,
    clear: false,
    clearBy: null,
    ...fields,
  };
}

describe("decide", () => {
  it("finds a show only when exactly one is clear", () => {
    expect(
      decide([candidate(1, { clear: true, clearBy: "unique" }), candidate(2)], {}, "Show"),
    ).toEqual({
      kind: "found",
      animeId: 1,
    });
    expect(decide([candidate(1), candidate(2)], {}, "Show")).toEqual({
      kind: "several",
      candidates: [1, 2],
    });
    expect(decide([], {}, "Show")).toEqual({ kind: "none" });
  });

  it("takes the one in progress only for forward progress", () => {
    const inProgress = [candidate(1, { clear: true, clearBy: "only_in_progress" }), candidate(2)];
    expect(decide(inProgress, { episodesWatched: 6 }, "Show").kind).toBe("found");
    expect(decide(inProgress, { score: 8 }, "Show").kind).toBe("several");
    expect(decide(inProgress, { status: "dropped" }, "Show").kind).toBe("several");
  });

  it("offers at most five", () => {
    const many = [1, 2, 3, 4, 5, 6, 7].map((id) => candidate(id));
    expect(decide(many, {}, "Show")).toEqual({ kind: "several", candidates: [1, 2, 3, 4, 5] });
  });
});

describe("decide and the title's words", () => {
  it("keeps a fuzzy match whose words aren't all in the name from being clear", () => {
    const blue = candidate(1, {
      clear: true,
      clearBy: "unique",
      title: "Blue Period",
      matchedName: "Blue Period",
    });
    expect(decide([blue], { score: 10 }, "perfect blue")).toEqual({
      kind: "several",
      candidates: [1],
    });
  });

  it("finds a show by a close spelling of its name, as Chat does", () => {
    const kabaneri = candidate(1, {
      clear: true,
      clearBy: "unique",
      title: "Koutetsujou no Kabaneri",
      matchedName: "Kabaneri of the Iron Fortress",
    });
    expect(decide([kabaneri], { episodesWatched: 7 }, "kabeneri")).toEqual({
      kind: "found",
      animeId: 1,
    });
  });
});

describe("noteLines and itemsFrom", () => {
  it("keeps the pasted line numbers, skipping blanks", () => {
    expect(noteLines("frieren\n\n  - jjk s2 \r\n")).toEqual([
      { lineNo: 1, text: "frieren" },
      { lineNo: 3, text: "- jjk s2" },
    ]);
    const long = Array.from({ length: MAX_IMPORT_LINES + 5 }, (_, i) => `show ${String(i)}`);
    expect(noteLines(long.join("\n"))).toHaveLength(MAX_IMPORT_LINES);
  });

  it("splits a line's shows, keeps the user's words, and never drops a line", () => {
    const lines = [
      { lineNo: 1, text: "finished frieren 10/10, dropped csm at ep 5" },
      { lineNo: 2, text: "ANIME 2024" },
      { lineNo: 3, text: "monster" },
    ];
    const items = itemsFrom(lines, [
      { line: 1, said: "finished frieren 10/10", title: "frieren", status: "completed", score: 10 },
      {
        line: 1,
        said: "dropped CSM at ep 5",
        title: "csm",
        status: "dropped",
        episodes_watched: 5,
      },
      { line: 2, not_a_show: true },
      // Line 3 isn't reported at all.
    ]);
    expect(items).toEqual([
      {
        lineNo: 1,
        position: 0,
        line: lines[0]?.text,
        said: "finished frieren 10/10",
        title: "frieren",
        notes: { status: "completed", score: 10 },
      },
      {
        lineNo: 1,
        position: 1,
        line: lines[0]?.text,
        said: "dropped CSM at ep 5",
        title: "csm",
        notes: { status: "dropped", episodesWatched: 5 },
      },
      { lineNo: 2, position: 0, line: "ANIME 2024", said: "ANIME 2024", title: null, notes: {} },
      {
        lineNo: 3,
        position: 0,
        line: "monster",
        said: "monster",
        title: null,
        notes: {},
        unread: true,
      },
    ]);
  });

  it("reads a null from the model as not given, never as 0", () => {
    // Two real readings (import@1 on Flash-Lite) that sent episodes_watched: null.
    const lines = [
      { lineNo: 3, text: "finished bocchi the rock 9/10" },
      { lineNo: 4, text: "perfect blue 10/10" },
    ];
    const reported = parseReport({
      items: [
        {
          line: 3,
          said: "finished bocchi the rock 9/10",
          score: 9,
          title: "bocchi the rock",
          status: "completed",
          episodes_watched: null,
        },
        {
          line: 4,
          said: "perfect blue 10/10",
          score: 10,
          title: "perfect blue",
          episodes_watched: null,
        },
      ],
    });
    const [bocchi, perfectBlue] = itemsFrom(lines, reported ?? []);
    expect(bocchi?.notes).toEqual({ status: "completed", score: 9 });
    expect(perfectBlue?.notes).toEqual({ score: 10 });

    // So each row is the one the notes mean, not Plan to Watch with a score or Completed at 0.
    const planned = entry({ status: "plan_to_watch", episodesWatched: 0 });
    expect(groupMatched(bocchi?.notes ?? {}, 12, planned)).toMatchObject({
      group: "update",
      change: { status: "completed", episodesWatched: 12, score: 9 },
      checked: true,
    });
    expect(groupMatched(perfectBlue?.notes ?? {}, 1, null)).toMatchObject({
      group: "add",
      change: { status: "completed", episodesWatched: 1, score: 10 },
      checked: true,
    });
  });

  it("doesn't reject a call over a null field, but still rejects a bad one", () => {
    expect(
      parseReport({
        items: [
          { line: 1, said: null, title: "monster", status: null, score: null, rewatching: null },
        ],
      }),
    ).toEqual([{ line: 1, title: "monster" }]);
    expect(parseReport({ items: [{ line: 1, title: "monster", score: 11 }] })).toBeNull();
    expect(parseReport({ items: null })).toBeNull();
  });

  it("falls back to the whole line when the model's words aren't really in it", () => {
    const [item] = itemsFrom(
      [{ lineNo: 1, text: "the eater one" }],
      [{ line: 1, said: "Soul Eater", title: "Soul Eater" }],
    );
    expect(item?.said).toBe("the eater one");
  });
});
