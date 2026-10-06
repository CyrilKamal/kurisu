import { describe, expect, it } from "vitest";

import { confirmationReasonLabel, describeChange, writeErrorMessage } from "../lib/describeChange";

describe("describeChange", () => {
  it("describes progress, status, score and rewatch changes", () => {
    expect(describeChange({ episodesWatched: 7 }, { episodesWatched: 8 })).toBe("ep 7 → 8");
    expect(
      describeChange(
        { episodesWatched: 11, status: "watching" },
        { episodesWatched: 12, status: "completed" },
      ),
    ).toBe("ep 11 → 12 · Watching → Completed");
    expect(describeChange({ score: 0 }, { score: 9 })).toBe("score – → 9");
    expect(describeChange({ isRewatching: false }, { isRewatching: true })).toBe("rewatching");
    expect(describeChange({ isRewatching: true }, { isRewatching: false })).toBe(
      "rewatch finished",
    );
  });

  it("copes with missing prior values", () => {
    expect(describeChange({}, { status: "dropped" })).toBe("? → Dropped");
  });
});

describe("messages", () => {
  it("explains confirmation reasons and write errors in plain words", () => {
    expect(confirmationReasonLabel("ambiguous_match")).toMatch(/show you meant/);
    expect(confirmationReasonLabel("not_yet_aired")).toMatch(/hasn't aired yet/);
    expect(confirmationReasonLabel("newest_episode_unknown")).toMatch(/newest episode/);
    expect(confirmationReasonLabel("score_not_given")).toMatch(/didn't give a score/);
    expect(confirmationReasonLabel("not_in_brief")).toMatch(/brief didn't list/);
    expect(confirmationReasonLabel(null)).toMatch(/confirmation/);
    expect(writeErrorMessage("changed_since")).toMatch(/overwrite the newer change/);
    expect(writeErrorMessage("something_new")).toMatch(/Something went wrong/);
  });
});
