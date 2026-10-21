import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return name.endsWith(".tsx") ? [path] : [];
  });
}

describe("links to show pages", () => {
  // Prefetching a show page makes the server load the show (and ask AniList), so a long list of
  // rows prefetched every show at once and covers queued behind them.
  it("are never prefetched", () => {
    const found = ["app", "components"]
      .flatMap(sourceFiles)
      .flatMap((file) =>
        [...readFileSync(file, "utf8").matchAll(/<Link\b[^>]*?href=\{showHref\([^>]*?>/gs)]
          .filter((match) => !match[0].includes("prefetch={false}"))
          .map((match) => `${file}: ${match[0].replace(/\s+/g, " ").slice(0, 80)}`),
      );
    expect(found).toEqual([]);
  });
});
