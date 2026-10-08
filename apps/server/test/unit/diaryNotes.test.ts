import { describe, expect, it } from "vitest";

import { MAX_NOTE, reactionWords } from "../../src/diary/notes.js";

describe("reactionWords", () => {
  const message = "finished frieren,   THAT finale was insane!! also ep 3 of jjk";

  it("keeps the user's own words for the part about the show", () => {
    expect(reactionWords(message, "that finale was insane")).toBe("THAT finale was insane");
    expect(reactionWords(message, "“that finale was insane!!”")).toBe("THAT finale was insane!!");
  });

  it("keeps the whole message when the model's words aren't the user's", () => {
    expect(reactionWords(message, "the finale was amazing")).toBe(
      "finished frieren, THAT finale was insane!! also ep 3 of jjk",
    );
    expect(reactionWords(message, "")).toBe(
      "finished frieren, THAT finale was insane!! also ep 3 of jjk",
    );
    expect(reactionWords("x".repeat(MAX_NOTE + 50), "nope")).toHaveLength(MAX_NOTE);
  });
});
