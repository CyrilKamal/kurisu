import { describe, expect, it } from "vitest";

import { mentionsWholeBrief } from "../../src/agent/briefReply.js";

describe("mentionsWholeBrief", () => {
  it("recognizes 'caught up on everything' replies", () => {
    for (const message of [
      "watched it",
      "Watched them",
      "watched them all",
      "just watched em",
      "watched 'em lol",
      "saw both",
      "watched everything",
      "done with all of them",
      "caught up",
      "all caught up!",
      "ok caught up on them",
      "finished it",
    ]) {
      expect(mentionsWholeBrief(message), message).toBe(true);
    }
  });

  it("ignores messages about one show or anything else", () => {
    for (const message of [
      "watched frieren",
      "caught up on frieren",
      "caught up with dandadan",
      "watched ep 5 of bsd",
      "what should I watch?",
      "itadakimasu",
      "watched item",
    ]) {
      expect(mentionsWholeBrief(message), message).toBe(false);
    }
  });
});
