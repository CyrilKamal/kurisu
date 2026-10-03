import { describe, expect, it } from "vitest";

import { mentionsNewestEpisode } from "../../src/agent/newestEpisode.js";

describe("mentionsNewestEpisode", () => {
  it("spots 'the newest episode' without a number", () => {
    for (const message of [
      "Watched the newest episode of X",
      "caught the latest ep of X",
      "Watched the new episode",
      "saw the ep that dropped today",
      "the episode that just came out was great",
      "just dropped ep of X watched",
      "caught up on X",
    ]) {
      expect([message, mentionsNewestEpisode(message)]).toEqual([message, true]);
    }
  });

  it("ignores messages that give the number, or aren't about the newest episode", () => {
    for (const message of [
      "caught up on X to ep 12",
      "watched the newest episode, episode 7",
      "I just watched the next episode of X",
      "watched 3 new episodes of X",
      "dropping X",
    ]) {
      expect([message, mentionsNewestEpisode(message)]).toEqual([message, false]);
    }
  });
});
