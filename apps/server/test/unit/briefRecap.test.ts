import { describe, expect, it } from "vitest";

import { chatText } from "../../src/brief/build.js";
import {
  isSunday,
  recapFrom,
  recapPushText,
  recapText,
  type BriefRecap,
} from "../../src/brief/recap.js";

const week = (fields: Partial<Parameters<typeof recapFrom>[0]> = {}) => ({
  episodes: 23,
  minutes: 552,
  shows: 4,
  finished: [] as { animeId: number; title: string }[],
  ...fields,
});
const year = { year: 2026, completed: 18, goal: 40 };

function recap(fields: Partial<BriefRecap> = {}): BriefRecap {
  return {
    episodes: 23,
    minutes: 552,
    shows: 4,
    finished: [],
    year: 2026,
    completed: 18,
    goal: 40,
    ...fields,
  };
}

describe("isSunday", () => {
  it("reads the user's local date", () => {
    expect(isSunday("2026-10-11")).toBe(true);
    expect(isSunday("2026-10-12")).toBe(false);
    expect(isSunday("not a date")).toBe(false);
  });
});

describe("recapFrom", () => {
  it("has nothing to say about a week with nothing watched or finished", () => {
    expect(recapFrom(week({ episodes: 0, minutes: 0, shows: 0 }), year)).toBeNull();
    expect(
      recapFrom(week({ finished: [{ animeId: 1, title: "Bocchi the Rock!" }] }), year),
    ).toMatchObject({ finished: ["Bocchi the Rock!"], completed: 18, goal: 40 });
  });
});

describe("recapText", () => {
  it("sums up the week and the year in one paragraph", () => {
    expect(recapText(recap({ finished: ["Bocchi the Rock!", "Frieren"] }))).toBe(
      "This week: 23 episodes (9.2 hours) across 4 shows. Finished Bocchi the Rock! and Frieren. 2026 goal: 18 of 40 shows.",
    );
    expect(recapText(recap({ episodes: 1, minutes: 0, shows: 1, goal: null, completed: 1 }))).toBe(
      "This week: 1 episode across 1 show. 1 show completed in 2026.",
    );
    expect(
      recapText(recap({ episodes: 0, minutes: 0, shows: 0, finished: ["A", "B", "C", "D", "E"] })),
    ).toBe(
      "This week: no new episodes logged. Finished A, B, C and 2 more. 2026 goal: 18 of 40 shows.",
    );
  });

  it("closes a brief, and is the notification when it's all the brief has", () => {
    expect(chatText("Frieren has a new episode.", [], [], recapText(recap())).split("\n")).toEqual([
      "Frieren has a new episode.",
      "",
      "This week: 23 episodes (9.2 hours) across 4 shows. 2026 goal: 18 of 40 shows.",
    ]);
    expect(recapPushText(recap({ finished: ["Frieren"] }))).toEqual({
      title: "Your week: 23 episodes",
      body: "Finished Frieren. 2026 goal: 18 of 40 shows. Tap to open the chat.",
    });
  });
});
