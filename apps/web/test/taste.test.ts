import type { TasteGenre } from "@kurisu/shared";
import { describe, expect, it } from "vitest";

import { formatAffinity, formatScore, GENRES_SHOWN, tasteSections } from "../lib/taste";

function genre(name: string, affinity: number, fields: Partial<TasteGenre> = {}): TasteGenre {
  return { genre: name, scored: 5, meanScore: 7, dropped: 0, affinity, ...fields };
}

describe("tasteSections", () => {
  it("splits scored genres into higher and lower, strongest first", () => {
    const sections = tasteSections([
      genre("Drama", 0.4),
      genre("Mystery", 0.9),
      genre("Comedy", 0.01),
      genre("Horror", -0.8),
      genre("Sports", -0.2),
    ]);
    expect(sections.higher.map((g) => g.genre)).toEqual(["Mystery", "Drama"]);
    expect(sections.lower.map((g) => g.genre)).toEqual(["Horror", "Sports"]);
    expect(sections.maxAffinity).toBe(0.9);
  });

  it("lists every genre with a score or a drop, and leaves out the rest", () => {
    const sections = tasteSections([
      genre("Fantasy", 0, { scored: 0, meanScore: null }),
      genre("Action", 0, { scored: 0, meanScore: null, dropped: 2 }),
      genre("Drama", 0.4),
    ]);
    expect(sections.all.map((g) => g.genre)).toEqual(["Drama", "Action"]);
    expect(sections.higher.map((g) => g.genre)).toEqual(["Drama"]);
    expect(sections.lower).toEqual([]);
  });

  it("shows at most a handful in each list", () => {
    const many = Array.from({ length: 12 }, (_, i) => genre(`G${String(i)}`, (i + 1) / 10));
    expect(tasteSections(many).higher).toHaveLength(GENRES_SHOWN);
    expect(tasteSections(many).all).toHaveLength(12);
  });

  it("handles a list with no scores", () => {
    expect(tasteSections([])).toEqual({ higher: [], lower: [], all: [], maxAffinity: 0 });
  });
});

describe("formatting", () => {
  it("signs differences and hides tiny ones", () => {
    expect(formatAffinity(0.83)).toBe("+0.8");
    expect(formatAffinity(-0.67)).toBe("−0.7");
    expect(formatAffinity(0.04)).toBe("0.0");
  });

  it("rounds scores to one decimal", () => {
    expect(formatScore(8.4321)).toBe("8.4");
    expect(formatScore(null)).toBe("–");
  });
});
