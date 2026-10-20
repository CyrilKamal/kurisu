import { describe, expect, it } from "vitest";

import { normalizeChange, type EntryState } from "../../src/writes/normalize.js";

const watching: EntryState = {
  status: "watching",
  episodesWatched: 5,
  numEpisodes: 12,
  isRewatching: false,
  score: 0,
};

describe("normalizeChange", () => {
  it("passes a plain progress update through", () => {
    expect(normalizeChange(watching, { episodesWatched: 6 })).toEqual({
      ok: true,
      change: { episodesWatched: 6 },
    });
  });

  it("completes the show on its final episode", () => {
    expect(normalizeChange(watching, { episodesWatched: 12 })).toEqual({
      ok: true,
      change: { episodesWatched: 12, status: "completed" },
    });
  });

  it("fills in the episode total when marked completed", () => {
    expect(normalizeChange(watching, { status: "completed" })).toEqual({
      ok: true,
      change: { status: "completed", episodesWatched: 12 },
    });
  });

  it("doesn't invent a total when MAL doesn't know it", () => {
    const unknown = { ...watching, numEpisodes: null };
    expect(normalizeChange(unknown, { status: "completed" })).toEqual({
      ok: true,
      change: { status: "completed" },
    });
    expect(normalizeChange(unknown, { episodesWatched: 40 })).toEqual({
      ok: true,
      change: { episodesWatched: 40 },
    });
  });

  it("moves plan_to_watch and on_hold to watching when progress is made", () => {
    for (const status of ["plan_to_watch", "on_hold"] as const) {
      expect(normalizeChange({ ...watching, status }, { episodesWatched: 6 })).toEqual({
        ok: true,
        change: { episodesWatched: 6, status: "watching" },
      });
    }
  });

  it("keeps a dropped show dropped unless the status is set", () => {
    const dropped = { ...watching, status: "dropped" as const };
    expect(normalizeChange(dropped, { episodesWatched: 12 })).toEqual({
      ok: true,
      change: { episodesWatched: 12 },
    });
    expect(normalizeChange(dropped, { status: "watching", episodesWatched: 6 })).toEqual({
      ok: true,
      change: { status: "watching", episodesWatched: 6 },
    });
  });

  it("an explicit status wins over the inferred one", () => {
    expect(normalizeChange(watching, { episodesWatched: 12, status: "on_hold" })).toEqual({
      ok: true,
      change: { episodesWatched: 12, status: "on_hold" },
    });
  });

  it("ends a rewatch on the final episode", () => {
    const rewatch = { ...watching, status: "completed" as const, isRewatching: true };
    expect(normalizeChange(rewatch, { episodesWatched: 12 })).toEqual({
      ok: true,
      change: { episodesWatched: 12, isRewatching: false },
    });
  });

  it("only starts a rewatch on a completed show", () => {
    const completed = { ...watching, status: "completed" as const, episodesWatched: 12 };
    expect(normalizeChange(completed, { isRewatching: true, episodesWatched: 1 })).toEqual({
      ok: true,
      change: { isRewatching: true, episodesWatched: 1 },
    });
    // "start it again" on a show that was paused isn't a rewatch.
    const paused = { ...watching, status: "on_hold" as const, episodesWatched: 0 };
    expect(normalizeChange(paused, { status: "watching", isRewatching: true })).toEqual({
      ok: false,
      error: "rewatch_not_completed",
    });
  });

  it("drops fields that don't change anything", () => {
    expect(normalizeChange(watching, { episodesWatched: 5, status: "watching" })).toEqual({
      ok: true,
      change: {},
    });
  });

  it("rejects impossible values", () => {
    expect(normalizeChange(watching, { episodesWatched: 13 })).toEqual({
      ok: false,
      error: "episodes_exceed_total",
    });
    expect(normalizeChange(watching, { episodesWatched: -1 })).toEqual({
      ok: false,
      error: "negative_episodes",
    });
    expect(normalizeChange(watching, { score: 11 })).toEqual({
      ok: false,
      error: "score_out_of_range",
    });
  });
});

describe("MAL's other list fields", () => {
  const known: EntryState = {
    ...watching,
    extras: { comments: "", tags: ["comfy"], priority: 0, timesRewatched: 0 },
  };

  it("pass through checked, with only real changes kept", () => {
    expect(
      normalizeChange(known, {
        comments: "  Great finale ",
        tags: ["Comfy", "isekai,  slow   burn", "comfy"],
        priority: 2,
        timesRewatched: 0,
      }),
    ).toEqual({
      ok: true,
      change: { comments: "Great finale", tags: ["Comfy", "isekai", "slow burn"], priority: 2 },
    });
    // The same tags in another order change nothing.
    expect(
      normalizeChange(
        { ...known, extras: { ...known.extras, tags: ["a", "b"] } },
        {
          tags: ["b", "a"],
        },
      ),
    ).toEqual({ ok: true, change: {} });
  });

  it("are refused when the mirror doesn't know them, or out of MAL's limits", () => {
    expect(normalizeChange(watching, { comments: "hi" })).toEqual({
      ok: false,
      error: "field_unknown",
    });
    expect(
      normalizeChange({ ...known, extras: { ...known.extras, tags: null } }, { tags: ["a"] }),
    ).toEqual({ ok: false, error: "field_unknown" });
    expect(normalizeChange(known, { comments: "x".repeat(2001) })).toMatchObject({
      error: "comments_too_long",
    });
    expect(
      normalizeChange(known, { tags: Array.from({ length: 21 }, (_, i) => `t${String(i)}`) }),
    ).toMatchObject({ error: "too_many_tags" });
    expect(normalizeChange(known, { tags: ["x".repeat(51)] })).toMatchObject({
      error: "tag_too_long",
    });
    expect(normalizeChange(known, { priority: 3 })).toMatchObject({
      error: "priority_out_of_range",
    });
    expect(normalizeChange(known, { timesRewatched: 1000 })).toMatchObject({
      error: "rewatch_count_out_of_range",
    });
  });

  it("leave the rules for the four core fields as they were", () => {
    expect(normalizeChange(known, { episodesWatched: 12, comments: "done" })).toEqual({
      ok: true,
      change: { status: "completed", episodesWatched: 12, comments: "done" },
    });
  });
});
