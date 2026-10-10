import { describe, expect, it } from "vitest";

import { finishes } from "../lib/finish";

const change = (fields: Partial<Parameters<typeof finishes>[0]> = {}) => ({
  kind: "update" as const,
  before: { status: "watching" as const, episodesWatched: 11 },
  after: { status: "completed" as const, episodesWatched: 12 },
  isUndo: false,
  undone: false,
  ...fields,
});

describe("finishes", () => {
  it("is a write that moves a show to Completed", () => {
    expect(finishes(change())).toBe(true);
    expect(finishes(change({ kind: "add", before: {} }))).toBe(true);
  });

  it("isn't an undo, an undone change, a rewatch ending or anything else", () => {
    expect(finishes(change({ isUndo: true }))).toBe(false);
    expect(finishes(change({ undone: true }))).toBe(false);
    expect(
      finishes(change({ before: { isRewatching: true }, after: { isRewatching: false } })),
    ).toBe(false);
    expect(finishes(change({ after: { episodesWatched: 12 } }))).toBe(false);
    expect(finishes(change({ before: { status: "completed" } }))).toBe(false);
  });
});
