import { describe, expect, it } from "vitest";

import { briefTitle } from "../../src/brief/build.js";
import { titleFrom } from "../../src/chat/titles.js";

describe("titleFrom", () => {
  it("keeps a short message as it is, on one line", () => {
    expect(titleFrom("watched ep 3 of frieren")).toBe("watched ep 3 of frieren");
    expect(titleFrom("  watched   ep 3\nof frieren ")).toBe("watched ep 3 of frieren");
  });

  it("cuts a long message at a word, under 60 characters", () => {
    const title = titleFrom(
      "what should I watch tonight, something chill and short since I only have forty minutes",
    );
    expect(title).toBe("what should I watch tonight, something chill and short…");
    expect(title.length).toBeLessThanOrEqual(60);
  });

  it("cuts mid-word when there's no word break near the end", () => {
    expect(titleFrom("a".repeat(70))).toBe(`${"a".repeat(59)}…`);
  });
});

describe("briefTitle", () => {
  it("names the day in the user's own date", () => {
    expect(briefTitle("2026-10-06")).toBe("Brief, Oct 6");
    expect(briefTitle("2026-12-31")).toBe("Brief, Dec 31");
    expect(briefTitle("not a date")).toBe("Brief");
  });
});
