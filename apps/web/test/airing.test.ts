import { describe, expect, it } from "vitest";

import { outLabel, untilLabel } from "../lib/airing";

const NOW = new Date("2026-10-10T12:00:00Z");
const later = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000);

describe("untilLabel", () => {
  it("uses the two largest units", () => {
    expect(untilLabel(later(2 * 1440 + 4 * 60 + 30), NOW)).toBe("2d 4h");
    expect(untilLabel(later(1440), NOW)).toBe("1d");
    expect(untilLabel(later(5 * 60 + 20), NOW)).toBe("5h 20m");
    expect(untilLabel(later(3 * 60), NOW)).toBe("3h");
    expect(untilLabel(later(12), NOW)).toBe("12m");
    expect(untilLabel(later(0.5), NOW)).toBe("1m");
    expect(untilLabel(later(-5), NOW)).toBe("now");
  });

  it("names the weekday a week or more out", () => {
    expect(untilLabel(new Date("2026-10-20T12:00:00Z"), NOW, "UTC")).toBe("Tue");
  });
});

describe("outLabel", () => {
  it("names one episode, or the run of them", () => {
    expect(outLabel(8, 9)).toBe("ep 9 out");
    expect(outLabel(6, 9)).toBe("3 out · eps 7–9");
  });
});
