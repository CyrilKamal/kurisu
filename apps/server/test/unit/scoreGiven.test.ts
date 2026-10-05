import { describe, expect, it } from "vitest";

import { mentionsNumber } from "../../src/agent/scoreGiven.js";

describe("mentionsNumber", () => {
  it("finds a score written as digits or a word", () => {
    for (const message of [
      "Death Note is a 10",
      "it was a 7",
      "Im gonna score monogatari an 8",
      "give it an eight",
      "8.5 for that one",
    ]) {
      expect([message, mentionsNumber(message)]).toEqual([message, true]);
    }
  });

  it("finds none in a message that only praises a show", () => {
    for (const message of ["Your name was sooooo good", "loved it", "best show ever"]) {
      expect([message, mentionsNumber(message)]).toEqual([message, false]);
    }
  });
});
