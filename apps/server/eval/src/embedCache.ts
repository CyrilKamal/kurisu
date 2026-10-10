import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import type { Embedder } from "../../src/llm/modelClient.js";
import type { EmbedPurpose } from "../../src/llm/types.js";
import { LOCAL_DIR } from "./synopses.js";

/**
 * An embedder that remembers what it embedded, in eval/local/ (gitignored), so repeated lab runs
 * don't embed the same text again. One file per model; keyed by purpose and text.
 */
export interface CachedEmbedder extends Embedder {
  /** Writes what's new to disk. */
  save(): void;
  readonly stats: { hits: number; misses: number };
}

export function cachedEmbedder(inner: Embedder): CachedEmbedder {
  const file = `${LOCAL_DIR}embeddings/${inner.model.replace(/[^a-z0-9.-]+/gi, "_")}.json`;
  const store: Record<string, number[]> = existsSync(file)
    ? (JSON.parse(readFileSync(file, "utf8")) as Record<string, number[]>)
    : {};
  const stats = { hits: 0, misses: 0 };
  let dirty = false;
  const keyOf = (text: string, purpose: EmbedPurpose) =>
    createHash("sha256").update(`${purpose}\n${text}`).digest("hex").slice(0, 32);

  return {
    model: inner.model,
    dimensions: inner.dimensions,
    stats,
    async embed(texts, purpose) {
      const keys = texts.map((text) => keyOf(text, purpose));
      const missing = [...new Set(texts.filter((_, i) => !store[keys[i] ?? ""]))];
      let inputTokens = 0;
      if (missing.length > 0) {
        const result = await inner.embed(missing, purpose);
        inputTokens = result.inputTokens;
        missing.forEach((text, i) => {
          // Six decimals is far finer than any similarity we compare, and halves the file.
          store[keyOf(text, purpose)] = (result.vectors[i] ?? []).map(
            (x) => Math.round(x * 1e6) / 1e6,
          );
        });
        dirty = true;
      }
      stats.hits += texts.length - missing.length;
      stats.misses += missing.length;
      return { vectors: keys.map((key) => store[key] ?? []), inputTokens };
    },
    save() {
      if (!dirty) return;
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, JSON.stringify(store));
      dirty = false;
    },
  };
}
