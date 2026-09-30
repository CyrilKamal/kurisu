import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { z } from "zod";

import { PROVIDER_NAMES, type ProviderName, type Usage } from "./types.js";

/** "provider:model", e.g. "gemini:gemini-3.5-flash-lite" or "ollama:qwen3.6:27b". */
export interface ModelRef {
  provider: ProviderName;
  model: string;
  /** The original "provider:model" string, used in logs and price lookups. */
  ref: string;
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

export const MODEL_ROLES = ["agent", "escalation", "eval"] as const;
export type ModelRole = (typeof MODEL_ROLES)[number];

const priceSchema = z.object({
  input: z.number().nonnegative(),
  output: z.number().nonnegative(),
  note: z.string().optional(),
});

const modelsFileSchema = z.object({
  roles: z.record(z.enum(MODEL_ROLES), z.string()),
  ollama: z
    .object({
      numCtx: z.number().int().positive(),
      think: z.boolean(),
      note: z.string().optional(),
    })
    .default({ numCtx: 8192, think: false }),
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
    return parseModelRef(value);
  };
  return { agent: pick("agent"), escalation: pick("escalation"), eval: pick("eval") };
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
