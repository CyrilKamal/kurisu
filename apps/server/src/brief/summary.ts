import { BRIEF_SUMMARY_V1 } from "../agent/prompts/briefSummary.v1.js";
import type { ModelClient } from "../llm/modelClient.js";
import type { ModelRef } from "../llm/modelConfig.js";
import { episodeCount, episodesLabel, templateSummary, type BriefItem } from "./build.js";

export const BRIEF_SUMMARY_PROMPT = BRIEF_SUMMARY_V1;

const MAX_LENGTH = 200;

export interface SummaryResult {
  text: string;
  source: "model" | "template";
  model: string;
  promptVersion: string;
  inputTokens: number | null;
  outputTokens: number | null;
  latencyMs: number | null;
  /** Why the model's line wasn't used, when it wasn't. */
  rejected: "model_error" | "failed_check" | null;
}

/**
 * The brief's first line, written by the model. Falls back to a template if the call fails or
 * the line doesn't pass `isSafeSummary`.
 */
export async function writeSummary(
  models: ModelClient,
  ref: ModelRef,
  items: BriefItem[],
): Promise<SummaryResult> {
  const base = { model: ref.ref, promptVersion: BRIEF_SUMMARY_PROMPT.version };
  const listing = items
    .map((item) =>
      [
        `${item.title}: ${episodesLabel(item.episodes)}`,
        item.premiere ? "premiere" : null,
        item.finale ? "finale" : null,
      ]
        .filter(Boolean)
        .join(", "),
    )
    .join("\n");

  try {
    const response = await models.chat(ref, {
      system: BRIEF_SUMMARY_PROMPT.system,
      messages: [{ role: "user", content: `New episodes:\n${listing}` }],
      tools: [],
    });
    const text = response.text.trim();
    const usage = {
      inputTokens: response.usage.inputTokens,
      outputTokens: response.usage.outputTokens,
      latencyMs: response.latencyMs,
    };
    if (isSafeSummary(text, items)) {
      return { ...base, ...usage, text, source: "model", rejected: null };
    }
    return {
      ...base,
      ...usage,
      text: templateSummary(items),
      source: "template",
      rejected: "failed_check",
    };
  } catch {
    return {
      ...base,
      text: templateSummary(items),
      source: "template",
      inputTokens: null,
      outputTokens: null,
      latencyMs: null,
      rejected: "model_error",
    };
  }
}

/**
 * A summary line is usable if it's one short line and every number in it comes from the brief:
 * an episode number, a count, or a number in a title. That catches an invented episode number.
 */
export function isSafeSummary(text: string, items: BriefItem[]): boolean {
  if (text.length === 0 || text.length > MAX_LENGTH || /[\r\n]/.test(text)) return false;
  const allowed = new Set<string>([String(items.length), String(episodeCount(items))]);
  for (const item of items) {
    for (const ep of item.episodes) allowed.add(String(ep));
    for (const n of item.title.match(/\d+/g) ?? []) allowed.add(String(Number(n)));
  }
  return (text.match(/\d+/g) ?? []).every((n) => allowed.has(String(Number(n))));
}
