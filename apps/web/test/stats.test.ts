import { describe, expect, it } from "vitest";

import {
  daysWatched,
  goalProgress,
  hoursWatched,
  monthLabel,
  shortDate,
  showCount,
} from "../lib/stats";

describe("stats formatting", () => {
  it("turns minutes into days and hours", () => {
    expect(daysWatched(0)).toBe("0.0");
    expect(daysWatched(17_856)).toBe("12.4");
    expect(hoursWatched(270)).toBe("4.5");
    expect(hoursWatched(1_380)).toBe("23");
  });

  it("writes MAL's dates and months briefly", () => {
    expect(monthLabel(1)).toBe("Jan");
    expect(monthLabel(12)).toBe("Dec");
    expect(shortDate("2026-03-04")).toBe("Mar 4");
    expect(shortDate("2026-03")).toBe("Mar");
    expect(shortDate("2026")).toBe("2026");
  });

  it("says how far along the goal is, capped once it's met", () => {
    expect(goalProgress(12, 40)).toEqual({ percent: 30, label: "12 of 40 shows" });
    expect(goalProgress(0, 1)).toEqual({ percent: 0, label: "0 of 1 show" });
    expect(goalProgress(41, 40)).toEqual({ percent: 100, label: "Goal met: 41 of 40 shows" });
    expect(showCount(1)).toBe("1 show");
    expect(showCount(2)).toBe("2 shows");
  });
});
