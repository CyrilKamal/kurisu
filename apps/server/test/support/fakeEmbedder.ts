import { createHash } from "node:crypto";

import type { Embedder } from "../../src/llm/modelClient.js";
import type { EmbedPurpose } from "../../src/llm/types.js";
import { EMBEDDING_DIMENSIONS } from "../../src/db/schema.js";

/**
 * A deterministic stand-in for an embedding model: each word adds to a few dimensions picked by
 * its hash, so texts sharing words point the same way and unrelated ones don't. Records what it
 * was asked to embed.
 */
export class FakeEmbedder implements Embedder {
  readonly model = "fake:bag-of-words";
  readonly dimensions = EMBEDDING_DIMENSIONS;
  readonly calls: { texts: string[]; purpose: EmbedPurpose }[] = [];

  embed(texts: string[], purpose: EmbedPurpose) {
    this.calls.push({ texts: [...texts], purpose });
    return Promise.resolve({
      vectors: texts.map((text) => vectorOf(text)),
      inputTokens: texts.reduce((n, text) => n + text.split(/\s+/).length, 0),
    });
  }

  reset(): void {
    this.calls.length = 0;
  }
}

export function vectorOf(text: string): number[] {
  const vector = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
  for (const word of text.toLowerCase().match(/[a-z0-9]+/g) ?? []) {
    const digest = createHash("sha256").update(word).digest();
    for (let i = 0; i < 3; i++) {
      const slot = digest.readUInt16BE(i * 2) % EMBEDDING_DIMENSIONS;
      vector[slot] = (vector[slot] ?? 0) + 1;
    }
  }
  const norm = Math.sqrt(vector.reduce((sum, x) => sum + x * x, 0)) || 1;
  return vector.map((x) => x / norm);
}
