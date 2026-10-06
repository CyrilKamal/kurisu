import { describe, expect, it } from "vitest";

import {
  briefAllows,
  briefRule,
  mentionsWholeBrief,
  namedEpisode,
} from "../../src/agent/briefReply.js";

describe("mentionsWholeBrief", () => {
  it("recognizes 'caught up on everything' replies", () => {
    for (const message of [
      "watched it",
      "Watched them",
      "watched them all",
      "just watched em",
      "watched 'em lol",
      "saw both",
      "watched both eps",
      "watched everything",
      "done with all of them",
      "caught up",
      "all caught up!",
      "caught up now",
      "ok caught up on them",
      "finished it",
      "finished them",
      "finished the show",
      "Watched the eps",
      "just saw it",
      "done",
      "finished",
      "all done!",
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
      "done with frieren",
      "finished frieren",
    ]) {
      expect(mentionsWholeBrief(message), message).toBe(false);
    }
  });
});

describe("namedEpisode", () => {
  it("reads the episode a message names", () => {
    expect(namedEpisode("watched ep 8")).toBe(8);
    expect(namedEpisode("watched episode 3")).toBe(3);
    expect(namedEpisode("watched the 2nd ep")).toBe(2);
    expect(namedEpisode("watched the first ep")).toBe(1);
    expect(namedEpisode("watched the premiere")).toBe(1);
    expect(namedEpisode("watched 3 clevatess")).toBeNull();
    expect(namedEpisode("watched a wistoria ep")).toBeNull();
  });
});

describe("briefRule", () => {
  it("follows the user's rules for replies to the brief", () => {
    const rules: [string, string][] = [
      ["watched it", "last"],
      ["done", "last"],
      ["finished", "last"],
      ["watched both eps", "last"],
      ["watched wistoria eps and daemons", "last"],
      ["watched daemons and clevatess", "last"],
      ["caught up on clevatess", "last"],
      ["watched the wistoria eps but didnt like clevatess dropping", "last"],
      ["watched the 2nd ep", "exact"],
      ["watched ep 8", "exact"],
      ["watched the premiere", "exact"],
      ["watched a wistoria ep and the other two", "upTo"],
      ["only watched one ep", "upTo"],
      ["watched 3 clevatess and daemons", "upTo"],
      ["didnt watch any yet", "none"],
      ["havent seen them", "none"],
    ];
    for (const [message, kind] of rules) {
      expect(briefRule(message).kind, message).toBe(kind);
    }
  });
});

describe("briefAllows", () => {
  // Listed eps 10–12, on ep 9.
  const listed = [10, 11, 12];

  it("pins progress to what the rule allows", () => {
    expect(briefAllows({ kind: "last" }, listed, 9, 12)).toBe(true);
    expect(briefAllows({ kind: "last" }, listed, 9, 10)).toBe(false);

    expect(briefAllows({ kind: "exact", episode: 11 }, listed, 9, 11)).toBe(true);
    expect(briefAllows({ kind: "exact", episode: 11 }, listed, 9, 12)).toBe(false);
    // An episode the brief didn't list for this show (it listed it for another one).
    expect(briefAllows({ kind: "exact", episode: 2 }, listed, 9, 2)).toBe(false);

    expect(briefAllows({ kind: "upTo" }, listed, 9, 10)).toBe(true);
    expect(briefAllows({ kind: "upTo" }, listed, 9, 12)).toBe(true);
    expect(briefAllows({ kind: "upTo" }, listed, 9, 13)).toBe(false);
    expect(briefAllows({ kind: "upTo" }, listed, 9, 9)).toBe(false);

    expect(briefAllows({ kind: "none" }, listed, 9, 10)).toBe(false);
    // A show the brief didn't list allows nothing.
    expect(briefAllows({ kind: "last" }, [], 0, 1)).toBe(false);
  });

  it("lets a count reach past episodes the brief didn't list, if they're before its last", () => {
    // Behind: on ep 1, the brief listed only ep 5; "3 more" is ep 4.
    expect(briefAllows({ kind: "upTo" }, [5], 1, 4)).toBe(true);
  });
});
