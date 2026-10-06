import { eq, inArray } from "drizzle-orm";

import type { Db } from "../db/client.js";
import { agentRuns, anime } from "../db/schema.js";
import type { ModelClient } from "../llm/modelClient.js";
import type { ModelRef } from "../llm/modelConfig.js";
import type { LlmMessage } from "../llm/types.js";
import type { Change, CommitErrorCode, ListWriter } from "../writes/commit.js";
import type { Proposal } from "../writes/propose.js";
import { namedShows } from "./briefReply.js";
import { runToolLoop } from "./toolLoop.js";
import {
  executeTool,
  toolSpecsFor,
  type CatalogSearch,
  type OptionalTool,
  type RunContext,
} from "./tools.js";

export interface Prompt {
  version: string;
  system: string;
  /** Tools beyond the base set this prompt was written for (see OPTIONAL_TOOLS). */
  tools?: readonly OptionalTool[];
}

export type AgentOutcome =
  "committed" | "needs_confirmation" | "clarification" | "no_action" | "error";

export interface RunInput {
  userId: string;
  conversationId: string | null;
  /** Earlier turns of this conversation, oldest first (text only). */
  history: { role: "user" | "assistant"; content: string }[];
  message: string;
  model: ModelRef;
  escalatedFromRunId?: string;
  /**
   * The morning brief this message replies to (the last history turn), as each show and the
   * episodes it listed. Lets "watched it" be checked against what the brief actually said.
   */
  brief?: { malId: number; episodes: number[] }[];
}

export interface RunResult {
  runId: string;
  model: string;
  outcome: AgentOutcome;
  reply: string;
  /** The model called recommend_shows: the recommendation agent answers next. */
  handedOff: boolean;
  /** True if the reply asks the user something. */
  asked: boolean;
  /** Shows a search or get_entry returned in this run, in the order first seen. */
  lookedUp: number[];
  committed: Change[];
  /** Proposals waiting for the user's confirmation. */
  pending: Proposal[];
  /** Commits that failed in this run (MAL said no, or the write path refused), in order. */
  commitErrors: CommitErrorCode[];
  error: string | null;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
}

export interface AgentDeps {
  db: Db;
  models: ModelClient;
  writeListStatus: ListWriter;
  /** Search of all anime, for prompts that offer search_anime. */
  catalog?: CatalogSearch;
  prompt: Prompt;
  /** Model turns before giving up. Each turn is one model call plus its tool calls. */
  maxTurns?: number;
}

const DEFAULT_MAX_TURNS = 6;
/** A reply to a brief can touch every show in it: search, propose and commit each. */
const BRIEF_REPLY_MAX_TURNS = 10;

/**
 * One agent run: the model reads the message, calls tools, and replies. Every model call and
 * tool call is logged to agent_run_steps; the run's totals and outcome to agent_runs.
 */
export async function runAgent(deps: AgentDeps, input: RunInput): Promise<RunResult> {
  const { db } = deps;
  const started = performance.now();
  const [run] = await db
    .insert(agentRuns)
    .values({
      userId: input.userId,
      conversationId: input.conversationId,
      escalatedFromRunId: input.escalatedFromRunId ?? null,
      promptVersion: deps.prompt.version,
      model: input.model.ref,
    })
    .returning({ id: agentRuns.id });
  if (!run) throw new Error("agent_runs insert returned no row");

  const brief = input.brief ? await briefShows(db, input.brief, input.message) : null;
  const ctx: RunContext = {
    db,
    userId: input.userId,
    runId: run.id,
    writeListStatus: deps.writeListStatus,
    catalog: deps.prompt.tools?.includes("search_anime") ? (deps.catalog ?? null) : null,
    seen: new Set(),
    latestAired: new Map(),
    briefEpisodes: input.brief
      ? new Map(input.brief.map((item) => [item.malId, item.episodes]))
      : null,
    briefNamed: brief?.named ?? new Set(),
    briefTitles: brief?.titles ?? [],
    clear: new Map(),
    proposalIds: new Set(),
    committed: [],
    commitErrors: [],
    pending: [],
    toldWaiting: new Set(),
    userMessage: input.message,
    contested: new Set(),
    // A brief isn't a question, even when a show's title ends in "?".
    answering:
      !input.brief &&
      input.history.at(-1)?.role === "assistant" &&
      input.history.at(-1)?.content.includes("?") === true,
    searches: new Map(),
    stop: null,
  };
  const messages: LlmMessage[] = [
    ...input.history.map((m): LlmMessage =>
      m.role === "user"
        ? { role: "user", content: m.content }
        : { role: "assistant", content: m.content, toolCalls: [] },
    ),
    { role: "user", content: input.message },
  ];

  const loop = await runToolLoop({
    db,
    runId: run.id,
    models: deps.models,
    model: input.model,
    system: deps.prompt.system,
    tools: toolSpecsFor(deps.prompt.tools),
    messages,
    maxTurns: deps.maxTurns ?? (input.brief ? BRIEF_REPLY_MAX_TURNS : DEFAULT_MAX_TURNS),
    execute: (call) => executeTool(ctx, call),
    shouldStop: () => ctx.stop !== null,
  });
  const { inputTokens, outputTokens } = loop;
  let reply = loop.reply;
  let error = loop.error;

  // Ran out of turns, or stopped for repeating itself. If changes were written or held, the
  // run still did its job: Chat shows them, so end with a plain reply instead of an error. A
  // model searching in circles gets an honest question back. agent_runs keeps the reason.
  let stopReason: string | null = null;
  if (reply === null && error === null) {
    if (ctx.stop === "handoff") {
      // Not an error: the recommender answers. Any changes made first still show.
      stopReason = "handoff";
      reply =
        ctx.committed.length > 0 || ctx.pending.length > 0
          ? fallbackReply(ctx.committed.length, ctx.pending.length)
          : "";
    } else if (ctx.committed.length > 0 || ctx.pending.length > 0) {
      stopReason = ctx.stop ?? "max_turns";
      reply = fallbackReply(ctx.committed.length, ctx.pending.length);
    } else if (ctx.stop === "repeated_search") {
      stopReason = ctx.stop;
      reply = "I couldn't work out which show you mean. Could you give me its full title?";
    } else {
      error = "max_turns";
    }
  }
  const text = reply ?? "";
  const asked = text.includes("?");
  const outcome: AgentOutcome = error
    ? "error"
    : ctx.committed.length > 0
      ? "committed"
      : ctx.pending.length > 0
        ? "needs_confirmation"
        : asked
          ? "clarification"
          : "no_action";
  const latencyMs = Math.round(performance.now() - started);

  await db
    .update(agentRuns)
    .set({
      finishedAt: new Date(),
      latencyMs,
      inputTokens,
      outputTokens,
      outcome,
      error: error ?? stopReason,
    })
    .where(eq(agentRuns.id, run.id));

  return {
    runId: run.id,
    model: input.model.ref,
    outcome,
    reply: text,
    handedOff: ctx.stop === "handoff",
    asked,
    lookedUp: [...ctx.seen],
    committed: ctx.committed,
    pending: ctx.pending,
    commitErrors: ctx.commitErrors,
    error,
    latencyMs,
    inputTokens,
    outputTokens,
  };
}

function fallbackReply(committed: number, held: number): string {
  if (held === 0) return "Done.";
  const waiting =
    held === 1 ? "That change needs your confirmation." : "Those changes need your confirmation.";
  return committed > 0 ? `Done. ${waiting.replace("That change", "One change")}` : waiting;
}

/**
 * For a reply to a brief: which of its shows the message names (by any title or nickname), and
 * the titles the brief wrote.
 */
async function briefShows(
  db: Db,
  brief: { malId: number }[],
  message: string,
): Promise<{ named: Set<number>; titles: string[] }> {
  const rows = await db
    .select({
      malId: anime.malId,
      title: anime.title,
      titleEn: anime.titleEn,
      titleJa: anime.titleJa,
      synonyms: anime.synonyms,
    })
    .from(anime)
    .where(
      inArray(
        anime.malId,
        brief.map((item) => item.malId),
      ),
    );
  const named = namedShows(
    message,
    rows.map((row) => ({
      malId: row.malId,
      names: [row.title, row.titleEn, row.titleJa, ...row.synonyms].filter(
        (name): name is string => !!name,
      ),
    })),
  );
  return { named, titles: rows.map((row) => row.title) };
}
