import { describe, expect, it } from "vitest";

import { claimsChange } from "../../src/agent/claims.js";

describe("claimsChange", () => {
  it("spots replies that say the list changed", () => {
    for (const reply of [
      "Updated Fixture Watching Show: you're on episode 9.",
      'Updated "Fixture Watching Show" — status set to dropped.',
      "I've marked Frieren as completed.",
      "Done — Fixture Watching Show is now at episode 9.",
      "You're now on episode 5 of JJK.",
      "Bumped it to 10.",
    ]) {
      expect(claimsChange(reply), reply).toBe(true);
    }
  });

  it("leaves replies alone that don't claim a change", () => {
    for (const reply of [
      "Which one do you mean: Isekai Alpha or Isekai Beta?",
      "That show isn't on your list.",
      "You're already at episode 8 of that one.",
      "I can only keep your list up to date; I can't recommend shows yet.",
      "Hi! Tell me what you watched.",
    ]) {
      expect(claimsChange(reply), reply).toBe(false);
    }
  });

  it("reads an honest failure as no claim", () => {
    for (const reply of [
      "PSYЯEN could not be updated right now.",
      "PSYЯEN couldn't be updated right now.",
      "PSYЯEN couldn’t be updated right now.",
      "Fixture Watching Show wasn't updated: MyAnimeList rejected the change.",
      "It hasn't been marked as completed.",
      "I wasn't able to get it updated.",
      "That cannot be changed right now.",
      "I was unable to get that updated.",
      "Nothing changed on your list.",
      "Nothing was updated.",
    ]) {
      expect(claimsChange(reply), reply).toBe(false);
    }
  });

  it("still spots a claim next to a negation", () => {
    for (const reply of [
      "Not a problem, I've updated it to episode 9.",
      "Don't worry, updated it.",
      "Frieren couldn't be updated, but I marked JJK as completed.",
      "You hadn't started it, so I marked it as watching.",
    ]) {
      expect(claimsChange(reply), reply).toBe(true);
    }
  });
});
