import type { Embedder } from "../../src/llm/modelClient.js";
import type { EmbedPurpose } from "../../src/llm/types.js";
import { EMBEDDING_DIMENSIONS } from "../../src/db/schema.js";

/**
 * An embedder whose "meaning" is whatever the test says: texts given the same concept point the
 * same way, and every other text points somewhere unrelated to all of them.
 */
export class ConceptEmbedder implements Embedder {
  readonly model = "fake:concepts";
  readonly dimensions = EMBEDDING_DIMENSIONS;
  readonly calls: { texts: string[]; purpose: EmbedPurpose }[] = [];
  private readonly axes = new Map<string, number>();

  constructor(private readonly meanings: Record<string, string>) {}

  embed(texts: string[], purpose: EmbedPurpose) {
    this.calls.push({ texts: [...texts], purpose });
    return Promise.resolve({ vectors: texts.map((text) => this.vectorOf(text)), inputTokens: 0 });
  }

  private vectorOf(text: string): number[] {
    const vector = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
    // Every text leans a little on the last axis, so none is all zeros.
    vector[EMBEDDING_DIMENSIONS - 1] = 0.1;
    const concept = this.meanings[text.toLowerCase()];
    if (concept !== undefined) {
      if (!this.axes.has(concept)) this.axes.set(concept, this.axes.size);
      vector[this.axes.get(concept) ?? 0] = 1;
    }
    const norm = Math.hypot(...vector);
    return vector.map((x) => x / norm);
  }
}
