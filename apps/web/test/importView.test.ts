import type { ImportItemView, ImportView } from "@kurisu/shared";
import { describe, expect, it } from "vitest";

import {
  disagreement,
  progress,
  rowAction,
  rowError,
  unanswered,
  willWrite,
} from "../lib/importView";

function item(fields: Partial<ImportItemView> = {}): ImportItemView {
  return {
    id: crypto.randomUUID(),
    lineNo: 1,
    line: "frieren",
    said: "frieren",
    title: "frieren",
    group: "add",
    show: null,
    candidates: [],
    malState: null,
    change: { status: "plan_to_watch" },
    note: null,
    checked: true,
    resolution: null,
    status: "pending",
    error: null,
    ...fields,
  };
}

function view(items: ImportItemView[], status: ImportView["status"] = "review"): ImportView {
  return {
    id: crypto.randomUUID(),
    status,
    error: null,
    createdAt: new Date().toISOString(),
    items,
  };
}

describe("willWrite and progress", () => {
  it("writes checked adds, updates and disagreements settled for the notes", () => {
    expect(willWrite(item())).toBe(true);
    expect(willWrite(item({ checked: false }))).toBe(false);
    expect(willWrite(item({ group: "disagree", checked: true, resolution: "use_notes" }))).toBe(
      true,
    );
    expect(willWrite(item({ group: "disagree", change: null, checked: true }))).toBe(false);
    expect(willWrite(item({ group: "up_to_date", change: null, checked: false }))).toBe(false);
  });

  it("counts what the review would write, then what the run did", () => {
    const review = view([
      item(),
      item({ checked: false }),
      item({ group: "which_one", change: null, checked: false }),
    ]);
    expect(progress(review).total).toBe(1);
    expect(unanswered(review)).toBe(1);

    const running = view(
      [
        item({ status: "committed" }),
        item({ status: "failed" }),
        item({ status: "pending" }),
        item({ status: "skipped" }),
      ],
      "running",
    );
    expect(progress(running)).toMatchObject({ total: 3, written: 1, failed: 1 });
  });
});

describe("what a row says", () => {
  it("describes adds and updates", () => {
    expect(
      rowAction(item({ change: { status: "completed", episodesWatched: 28, score: 10 } })),
    ).toBe("Add as Completed, 10/10");
    expect(
      rowAction(
        item({
          group: "update",
          malState: { status: "watching", episodesWatched: 7, score: 0, isRewatching: false },
          change: { episodesWatched: 9 },
        }),
      ),
    ).toBe("ep 7 → 9");
  });

  it("shows a disagreement in the fields that differ", () => {
    expect(
      disagreement(
        item({
          group: "disagree",
          malState: { status: "completed", episodesWatched: 12, score: 9, isRewatching: false },
          change: { status: "dropped", episodesWatched: 5 },
        }),
      ),
    ).toEqual({ mal: "Completed, ep 12", notes: "Dropped, ep 5" });
  });

  it("explains failures", () => {
    expect(rowError("changed_since_review")).toBe(
      "Changed on your list since you reviewed it, so it was left alone.",
    );
    expect(rowError(null)).toBeNull();
  });
});
