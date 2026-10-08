import { describe, expect, it } from "vitest";

import { proposeArgs, toolSpecsFor } from "../../src/agent/tools.js";

describe("toolSpecsFor", () => {
  it("offers search_anime only to prompts that list it", () => {
    const names = (extra?: Parameters<typeof toolSpecsFor>[0]) =>
      toolSpecsFor(extra).map((t) => t.name);
    expect(names()).not.toContain("search_anime");
    expect(names()).toContain("search_my_list");
    expect(names(["search_anime"])).toContain("search_anime");
  });
});

describe("proposeArgs", () => {
  // Models sometimes send null for a field they mean to leave out. z.coerce would read it as 0.
  it("reads a null score as not given, so it can't clear the score", () => {
    const args = proposeArgs.parse({ anime_id: 1, episodes_watched: 5, score: null });
    expect(args.score).toBeUndefined();
    expect(args.episodes_watched).toBe(5);
  });

  it("reads null episodes_watched as not given, so progress isn't reset to 0", () => {
    const args = proposeArgs.parse({ anime_id: 1, status: "completed", episodes_watched: null });
    expect(args.episodes_watched).toBeUndefined();
    expect(args.status).toBe("completed");
  });

  it("reads null episodes_delta as not given, so episodes_watched stands alone", () => {
    const args = proposeArgs.parse({ anime_id: 1, episodes_watched: 5, episodes_delta: null });
    expect(args.episodes_delta).toBeUndefined();
    expect(args.episodes_watched).toBe(5);
  });

  it("reads null as not given for the other optional fields too", () => {
    const args = proposeArgs.parse({
      anime_id: 1,
      score: 8,
      status: null,
      is_rewatching: null,
      drop_reason: null,
    });
    expect(args).toMatchObject({ anime_id: 1, score: 8 });
    expect(args.status).toBeUndefined();
    expect(args.is_rewatching).toBeUndefined();
    expect(args.drop_reason).toBeUndefined();
  });

  it("still takes an explicit 0 and numbers sent as strings", () => {
    expect(proposeArgs.parse({ anime_id: "7", score: 0 })).toEqual({ anime_id: 7, score: 0 });
    expect(proposeArgs.parse({ anime_id: 7, episodes_watched: "3" }).episodes_watched).toBe(3);
  });

  it("still rejects unknown fields, values out of range and a null anime_id", () => {
    expect(proposeArgs.safeParse({ anime_id: 1, Score: 3 }).success).toBe(false);
    expect(proposeArgs.safeParse({ anime_id: 1, score: 11 }).success).toBe(false);
    expect(proposeArgs.safeParse({ anime_id: 1, episodes_watched: -1 }).success).toBe(false);
    expect(proposeArgs.safeParse({ anime_id: null, score: 8 }).success).toBe(false);
  });
});
