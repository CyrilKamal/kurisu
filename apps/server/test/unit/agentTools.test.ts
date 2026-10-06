import { describe, expect, it } from "vitest";

import { toolSpecsFor } from "../../src/agent/tools.js";

describe("toolSpecsFor", () => {
  it("offers search_anime only to prompts that list it", () => {
    const names = (extra?: Parameters<typeof toolSpecsFor>[0]) =>
      toolSpecsFor(extra).map((t) => t.name);
    expect(names()).not.toContain("search_anime");
    expect(names()).toContain("search_my_list");
    expect(names(["search_anime"])).toContain("search_anime");
  });
});
