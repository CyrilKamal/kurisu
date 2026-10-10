import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { z } from "zod";

import {
  PROVIDER_NAMES,
  THINKING_LEVELS,
  type ProviderName,
  type ThinkingLevel,
  type Usage,
} from "./types.js";

/** "provider:model", e.g. "gemini:gemini-3.5-flash-lite" or "ollama:qwen3.6:27b". */
export interface ModelRef {
  provider: ProviderName;
  model: string;
  /** The original "provider:model" string, used in logs and price lookups. */
  ref: string;
  /** How much the model thinks in this role (config/models.json "thinking"); unset is its default. */
  thinking?: ThinkingLevel;
}

export function parseModelRef(value: string): ModelRef {
  const colon = value.indexOf(":");
  const provider = value.slice(0, colon);
  const model = value.slice(colon + 1);
  if (
    colon <= 0 ||
    model.length === 0 ||
    !(PROVIDER_NAMES as readonly string[]).includes(provider)
  ) {
    throw new Error(
      `Invalid model reference "${value}". Use provider:model with provider one of ${PROVIDER_NAMES.join(", ")}.`,
    );
  }
  return { provider: provider as ProviderName, model, ref: value };
}

export const MODEL_ROLES = ["agent", "escalation", "eval", "brief", "recommend"] as const;
export type ModelRole = (typeof MODEL_ROLES)[number];

const priceSchema = z.object({
  input: z.number().nonnegative(),
  output: z.number().nonnegative(),
  note: z.string().optional(),
});

const thinkingLevel = z.enum(THINKING_LEVELS).optional();

const modelsFileSchema = z.object({
  roles: z.record(z.enum(MODEL_ROLES), z.string()),
  ollama: z
    .object({
      numCtx: z.number().int().positive(),
      think: z.boolean(),
      note: z.string().optional(),
    })
    .default({ numCtx: 8192, think: false }),
  /** A thinking level per role, for thinking models; roles not listed use the model's default. */
  thinking: z
    .object({
      agent: thinkingLevel,
      escalation: thinkingLevel,
      eval: thinkingLevel,
      brief: thinkingLevel,
      recommend: thinkingLevel,
      note: z.string().optional(),
    })
    .strict()
    .optional(),
  /**
   * The model that turns text into vectors (Milestone 7's lab), and its vector size, which the
   * database's column fixes. `prefixes` are the task words some models expect before a query or
   * a document (EmbeddingGemma's "task: search result | query: ").
   */
  embedding: z
    .object({
      model: z.string(),
      dimensions: z.number().int().positive(),
      prefixes: z.object({ query: z.string(), document: z.string() }).partial().default({}),
      note: z.string().optional(),
    })
    .optional(),
  /**
   * Milestone 7's lab models, outside the app: the one that answers questions about the list
   * (`ask`) and the one that grades those answers in the RAG eval (`judge`).
   */
  lab: z.object({ ask: z.string(), judge: z.string(), note: z.string().optional() }).optional(),
  /** USD per 1M tokens. Keys are model refs; "provider:*" matches any model of a provider. */
  pricesPerMillionTokens: z.record(z.string(), priceSchema),
});
export type ModelsFile = z.infer<typeof modelsFileSchema>;

export const MODELS_FILE = fileURLToPath(new URL("../../config/models.json", import.meta.url));

export function loadModelsFile(path: string = MODELS_FILE): ModelsFile {
  return modelsFileSchema.parse(JSON.parse(readFileSync(path, "utf8")));
}

/** Which model plays each role: config/models.json, overridable per environment variable. */
export function resolveRoles(
  file: ModelsFile,
  overrides: Partial<Record<ModelRole, string | undefined>>,
): Record<ModelRole, ModelRef> {
  const pick = (role: ModelRole) => {
    const value = overrides[role] ?? file.roles[role];
    if (!value) throw new Error(`No model configured for role "${role}" in config/models.json.`);
    const thinking = file.thinking?.[role];
    return { ...parseModelRef(value), ...(thinking && { thinking }) };
  };
  return {
    agent: pick("agent"),
    escalation: pick("escalation"),
    eval: pick("eval"),
    brief: pick("brief"),
    recommend: pick("recommend"),
  };
}

/** The lab's answering and judging models, from config/models.json or a "provider:model" each. */
export function resolveLab(
  file: ModelsFile,
  overrides: { ask?: string | undefined; judge?: string | undefined } = {},
): { ask: ModelRef; judge: ModelRef } {
  const ask = overrides.ask ?? file.lab?.ask;
  const judge = overrides.judge ?? file.lab?.judge;
  if (!ask || !judge) throw new Error('No "lab" models configured in config/models.json.');
  return { ask: parseModelRef(ask), judge: parseModelRef(judge) };
}

/** The embedding model, its vector size and its task prefixes. */
export interface EmbeddingRef extends ModelRef {
  dimensions: number;
  prefixes: { query?: string; document?: string };
}

/** The embedding model from config/models.json, or the EMBEDDING_MODEL override. */
export function resolveEmbedding(file: ModelsFile, override?: string): EmbeddingRef {
  const config = file.embedding;
  if (!config) throw new Error('No "embedding" model configured in config/models.json.');
  const ref = parseModelRef(override ?? config.model);
  // An override's prefixes would be the configured model's, so only keep them for that model.
  const prefixes = ref.ref === config.model ? config.prefixes : {};
  return { ...ref, dimensions: config.dimensions, prefixes };
}

/**
 * What a call would cost at paid-tier prices. Free-tier and local calls cost nothing, but the
 * eval still reports this so a model swap's cost is visible before it matters.
 */
export function costUsd(file: ModelsFile, ref: ModelRef, usage: Usage): number | null {
  const price =
    file.pricesPerMillionTokens[ref.ref] ?? file.pricesPerMillionTokens[`${ref.provider}:*`];
  if (!price) return null;
  return (usage.inputTokens * price.input + usage.outputTokens * price.output) / 1_000_000;
}
