import { eq } from "drizzle-orm";
import { z } from "zod";

import { runToolLoop, type ToolOutcome } from "../agent/toolLoop.js";
import type { Db } from "../db/client.js";
import { agentRuns } from "../db/schema.js";
import type { ModelClient } from "../llm/modelClient.js";
import type { ModelRef } from "../llm/modelConfig.js";
import type { ToolCall, ToolSpec } from "../llm/types.js";
import { MAL_LIST_STATUSES } from "../mal/client.js";
import type { RequestedChange } from "../writes/normalize.js";

export interface ReadDeps {
  db: Db;
  models: ModelClient;
  model: ModelRef;
  prompt: { version: string; system: string };
}

/** The most a paste may hold. */
export const MAX_IMPORT_CHARS = 20_000;
export const MAX_IMPORT_LINES = 400;
/** Lines the model reads per call. */
const LINES_PER_CALL = 25;

export interface NoteLine {
  /** 1-based, counting the pasted text's lines (blank ones included). */
  lineNo: number;
  text: string;
}

/** One show the notes mention, as the model read it, before any matching. */
export interface ParsedItem {
  lineNo: number;
  /** Its place on the line, when a line mentions several shows. */
  position: number;
  line: string;
  /** The user's own words about this show (a part of the line, or all of it). */
  said: string;
  /** The name exactly as written; null for a line that isn't about a show. */
  title: string | null;
  /** What the notes say: status, episodes, score, rewatching. */
  notes: RequestedChange;
  /** True when the model reported nothing for this line, so the user still sees it. */
  unread?: boolean;
}

/** The pasted text's lines worth reading: trimmed, blank ones left out, numbered as pasted. */
export function noteLines(text: string): NoteLine[] {
  return text
    .split(/\r?\n/)
    .map((line, i) => ({ lineNo: i + 1, text: line.trim() }))
    .filter((line) => line.text.length > 0)
    .slice(0, MAX_IMPORT_LINES);
}

const itemSchema = z.object({
  line: z.coerce.number().int(),
  said: z.string().optional(),
  title: z.string().optional(),
  not_a_show: z.boolean().optional(),
  status: z.enum(MAL_LIST_STATUSES).optional(),
  episodes_watched: z.coerce.number().int().min(0).optional(),
  score: z.coerce.number().int().min(1).max(10).optional(),
  rewatching: z.boolean().optional(),
});
const reportArgs = z.object({ items: z.array(itemSchema) });
type ReportedItem = z.infer<typeof itemSchema>;

const REPORT_TOOL: ToolSpec = {
  name: "report_items",
  description: "Report every show on the lines given, with only what each line says about it.",
  parameters: {
    type: "object",
    properties: {
      items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            line: { type: "integer" },
            said: { type: "string", description: "The words about this show, copied exactly" },
            title: { type: "string", description: "The show's name exactly as written" },
            not_a_show: { type: "boolean" },
            status: { type: "string", enum: [...MAL_LIST_STATUSES] },
            episodes_watched: { type: "integer" },
            score: { type: "integer", description: "1 to 10" },
            rewatching: { type: "boolean" },
          },
          required: ["line"],
        },
      },
    },
    required: ["items"],
  },
};

function squash(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Turns the model's report for some lines into items. The user's words are kept as written: a
 * `said` that isn't really in the line falls back to the whole line, and a line the model skipped
 * still gets an item, so nothing in the notes goes unseen.
 */
export function itemsFrom(lines: NoteLine[], reported: ReportedItem[]): ParsedItem[] {
  const items: ParsedItem[] = [];
  for (const line of lines) {
    const mine = reported.filter((r) => r.line === line.lineNo);
    if (mine.length === 0) {
      items.push({
        lineNo: line.lineNo,
        position: 0,
        line: line.text,
        said: line.text,
        title: null,
        notes: {},
        unread: true,
      });
      continue;
    }
    mine.forEach((r, position) => {
      const said = r.said && squash(line.text).includes(squash(r.said)) ? r.said.trim() : line.text;
      const written = r.title?.trim();
      const title = r.not_a_show || !written ? null : written;
      items.push({
        lineNo: line.lineNo,
        position,
        line: line.text,
        said,
        title,
        notes: {
          ...(r.status !== undefined && { status: r.status }),
          ...(r.episodes_watched !== undefined && { episodesWatched: r.episodes_watched }),
          ...(r.score !== undefined && { score: r.score }),
          ...(r.rewatching !== undefined && { isRewatching: r.rewatching }),
        },
      });
    });
  }
  return items;
}

/**
 * Has the model read the notes, a chunk of lines per call, each call logged as an agent run.
 * Returns null if a chunk couldn't be read (the model never reported it).
 */
export async function readNotes(
  deps: ReadDeps,
  userId: string,
  lines: NoteLine[],
): Promise<ParsedItem[] | null> {
  const items: ParsedItem[] = [];
  for (let i = 0; i < lines.length; i += LINES_PER_CALL) {
    const chunk = lines.slice(i, i + LINES_PER_CALL);
    const reported = await readChunk(deps, userId, chunk);
    if (!reported) return null;
    items.push(...itemsFrom(chunk, reported));
  }
  return items;
}

async function readChunk(
  deps: ReadDeps,
  userId: string,
  chunk: NoteLine[],
): Promise<ReportedItem[] | null> {
  const started = performance.now();
  const [run] = await deps.db
    .insert(agentRuns)
    .values({ userId, promptVersion: deps.prompt.version, model: deps.model.ref })
    .returning({ id: agentRuns.id });
  if (!run) throw new Error("agent_runs insert returned no row");

  // Set by the tool call (a holder, so the compiler sees it can change).
  const state: { reported: ReportedItem[] | null } = { reported: null };
  const execute = (call: ToolCall): Promise<ToolOutcome> => {
    if (call.name !== "report_items") {
      return Promise.resolve({
        result: { error: "unknown_tool", message: "Call report_items." },
        error: "unknown_tool",
      });
    }
    const args = reportArgs.safeParse(call.arguments);
    if (!args.success) {
      return Promise.resolve({
        result: { error: "invalid_arguments", message: "Pass items: one per show, as described." },
        error: "invalid_arguments",
      });
    }
    state.reported = args.data.items;
    return Promise.resolve({ result: { status: "ok" } });
  };

  const loop = await runToolLoop({
    db: deps.db,
    runId: run.id,
    models: deps.models,
    model: deps.model,
    system: deps.prompt.system,
    tools: [REPORT_TOOL],
    messages: [
      { role: "user", content: chunk.map((l) => `${String(l.lineNo)}: ${l.text}`).join("\n") },
    ],
    // One more turn if the first call's arguments didn't hold up.
    maxTurns: 2,
    execute,
    shouldStop: () => state.reported !== null,
  });
  await deps.db
    .update(agentRuns)
    .set({
      finishedAt: new Date(),
      latencyMs: Math.round(performance.now() - started),
      inputTokens: loop.inputTokens,
      outputTokens: loop.outputTokens,
      outcome: state.reported ? "no_action" : "error",
      error: state.reported ? null : (loop.error ?? "not_reported"),
    })
    .where(eq(agentRuns.id, run.id));
  return state.reported;
}
