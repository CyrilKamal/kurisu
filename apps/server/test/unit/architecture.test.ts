import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * Structural checks for CLAUDE.md's hard rules, backing up the lint rules so a rule can't be
 * silently disabled with an eslint-disable comment.
 */

const SRC = fileURLToPath(new URL("../../src/", import.meta.url));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return name.endsWith(".ts") ? [full] : [];
  });
}

function importers(pattern: RegExp): string[] {
  return sourceFiles(SRC)
    .filter((file) => pattern.test(readFileSync(file, "utf8")))
    .map((file) => path.relative(SRC, file).split(path.sep).join("/"))
    .sort();
}

describe("architecture", () => {
  it("imports model SDKs only in src/llm/providers/", () => {
    const sdkImport = /from\s+["'](@google\/genai|ollama|openai|@anthropic-ai\/[^"']+)["']/;
    for (const file of importers(sdkImport)) {
      expect(file.startsWith("llm/providers/"), `${file} imports a model SDK`).toBe(true);
    }
  });

  it("writes to MAL only from writes/commit.ts", () => {
    // Nothing writes to MAL except commit_update.
    expect(importers(/from\s+["'][^"']*writeClient\.js["']/)).toEqual(["writes/commit.ts"]);
    // And the write client is the only code that sends a PATCH to MAL.
    expect(importers(/method:\s*"PATCH"/)).toEqual(["mal/writeClient.ts"]);
  });
});
