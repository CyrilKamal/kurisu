import { describe, expect, it } from "vitest";

import { plainSynopsis } from "../../src/anilist/synopsis.js";

describe("plainSynopsis", () => {
  it("keeps paragraphs and drops markup, spoilers and extra blank lines", () => {
    expect(
      plainSynopsis(
        "Line one<br>\nline <b>two</b>.<br><br><br>\n~!A spoiler\nover lines.!~ After &#8212; it&#039;s &quot;fine&quot; &hellip; &unknown;",
      ),
    ).toBe('Line one\nline two.\n\nAfter — it\'s "fine" … &unknown;');
  });

  it("is empty when AniList's text is only markup", () => {
    expect(plainSynopsis("<br><br>")).toBe("");
  });
});
