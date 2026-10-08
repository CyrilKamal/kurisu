import { eq } from "drizzle-orm";
import { z } from "zod";

import type { Prompt } from "../agent/runAgent.js";
import { runToolLoop, type ToolOutcome } from "../agent/toolLoop.js";
import type { Db } from "../db/client.js";
import { agentRuns, discoveryRuns, recommendations } from "../db/schema.js";
import type { ModelClient } from "../llm/modelClient.js";
import type { ModelRef } from "../llm/modelConfig.js";
import type { LlmMessage, ToolCall, ToolSpec } from "../llm/types.js";
import { refreshTaste } from "../taste/profile.js";
import {
  candidateRows,
  discoveryRows,
  knownGenres,
  MEDIA_TYPES,
  POOLS,
  rankCandidates,
  tasteSignals,
  type Candidate,
  type Constraints,
} from "./candidates.js";
import { rememberDiscovered } from "./discovery.js";

/** Picks per recommendation (the user's choice). */
export const MAX_PICKS = 3;
/** Candidates shown to the model per search. */
const CANDIDATES_SHOWN = 15;
const MAX_TURNS = 6;
const MAX_WHY = 160;

export interface RecommendInput {
  userId: string;
  conversationId: string | null;
  /** Earlier turns of this conversation, oldest first (text only). */
  history: { role: "user" | "assistant"; content: string }[];
  message: string;
  model: ModelRef;
  /** The progress-sync run that handed the message over. */
  handedOffFromRunId: string | null;
}

export interface Pick {
  animeId: number;
  why: string;
}

export interface RecommendResult {
  runId: string;
  outcome: "recommended" | "clarification" | "no_action" | "error";
  reply: string;
  picks: Pick[];
  /** The recommendations row, when picks were presented. */
  recommendationId: string | null;
  error: string | null;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
}

const TOOL_SPECS: ToolSpec[] = [
  {
    name: "find_candidates",
    description:
      "Search the user's Plan to Watch, the shows they've started, the shows queued on their Watching list but not started, and shows new to them (picked from AniList by their taste) that meet the constraints, best fit first, with the facts behind each. When fewer than 3 shows fit the time given, shows up to 5 minutes over follow them, marked with how far over they run.",
    parameters: {
      type: "object",
      properties: {
        available_minutes: {
          type: "integer",
          description: "Minutes they have; each episode must fit",
        },
        max_episodes_left: { type: "integer", description: "At most this many episodes left" },
        genres_any: {
          type: "array",
          items: { type: "string" },
          description: "MyAnimeList genres; the show needs at least one",
        },
        genres_none: {
          type: "array",
          items: { type: "string" },
          description: "MyAnimeList genres to avoid",
        },
        media_types: { type: "array", items: { type: "string", enum: [...MEDIA_TYPES] } },
        from: {
          type: "array",
          items: { type: "string", enum: [...POOLS] },
          description: "Where to look; all four if not set",
        },
      },
    },
  },
  {
    name: "present_picks",
    description: `Show up to ${String(MAX_PICKS)} picks, best first, each with a one-line reason. Only anime_id values find_candidates returned.`,
    parameters: {
      type: "object",
      properties: {
        picks: {
          type: "array",
          items: {
            type: "object",
            properties: { anime_id: { type: "integer" }, why: { type: "string" } },
            required: ["anime_id", "why"],
          },
        },
      },
      required: ["picks"],
    },
  },
];

const findArgs = z
  .object({
    available_minutes: z.coerce.number().int().positive().optional(),
    max_episodes_left: z.coerce.number().int().positive().optional(),
    genres_any: z.array(z.string()).optional(),
    genres_none: z.array(z.string()).optional(),
    media_types: z.array(z.enum(MEDIA_TYPES)).optional(),
    from: z.array(z.enum(POOLS)).optional(),
  })
  .strict();

const presentArgs = z
  .object({
    picks: z
      .array(z.object({ anime_id: z.coerce.number().int().positive(), why: z.string() }).strict())
      .min(1),
  })
  .strict();

interface RecContext {
  db: Db;
  userId: string;
  /** Candidates any search in this run returned, with that search's constraints. */
  offered: Map<number, { candidate: Candidate; constraints: Constraints }>;
  genres: string[] | null;
  tasteFresh: boolean;
  picks: Pick[];
  recommendationId: string | null;
  runId: string;
}

/**
 * One recommendation run: the agent searches the user's backlog with the constraints in their
 * message, then presents up to three picks with one-line reasons. Picks can only be shows a
 * search in this run returned. Logged like every agent run.
 */
export async function runRecommender(
  deps: { db: Db; models: ModelClient; prompt: Prompt },
  input: RecommendInput,
): Promise<RecommendResult> {
  const { db } = deps;
  const started = performance.now();
  const [run] = await db
    .insert(agentRuns)
    .values({
      userId: input.userId,
      conversationId: input.conversationId,
      handedOffFromRunId: input.handedOffFromRunId,
      promptVersion: deps.prompt.version,
      model: input.model.ref,
    })
    .returning({ id: agentRuns.id });
  if (!run) throw new Error("agent_runs insert returned no row");

  const ctx: RecContext = {
    db,
    userId: input.userId,
    offered: new Map(),
    genres: null,
    tasteFresh: false,
    picks: [],
    recommendationId: null,
    runId: run.id,
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
    tools: TOOL_SPECS,
    messages,
    maxTurns: MAX_TURNS,
    execute: (call) => execute(ctx, call),
    shouldStop: () => false,
  });

  let error = loop.error;
  let reply = loop.reply;
  if (reply === null && error === null) {
    if (ctx.picks.length > 0) reply = "Here's what I'd watch.";
    else error = "max_turns";
  }
  const text = reply ?? "";
  const outcome: RecommendResult["outcome"] = error
    ? "error"
    : ctx.picks.length > 0
      ? "recommended"
      : text.includes("?")
        ? "clarification"
        : "no_action";
  const latencyMs = Math.round(performance.now() - started);
  await db
    .update(agentRuns)
    .set({
      finishedAt: new Date(),
      latencyMs,
      inputTokens: loop.inputTokens,
      outputTokens: loop.outputTokens,
      outcome,
      error,
    })
    .where(eq(agentRuns.id, run.id));

  return {
    runId: run.id,
    outcome,
    reply: text,
    picks: ctx.picks,
    recommendationId: ctx.recommendationId,
    error,
    latencyMs,
    inputTokens: loop.inputTokens,
    outputTokens: loop.outputTokens,
  };
}

function execute(ctx: RecContext, call: ToolCall): Promise<ToolOutcome> {
  switch (call.name) {
    case "find_candidates":
      return findCandidatesTool(ctx, call.arguments);
    case "present_picks":
      return presentPicksTool(ctx, call.arguments);
    default:
      return Promise.resolve(failure("unknown_tool", `There is no tool named ${call.name}.`));
  }
}

async function findCandidatesTool(ctx: RecContext, raw: unknown): Promise<ToolOutcome> {
  const args = findArgs.safeParse(raw);
  if (!args.success) return failure("invalid_arguments", "Check the fields; see the tool schema.");
  const a = args.data;

  // Taste memory is refreshed once per run, so it reflects the latest changes.
  if (!ctx.tasteFresh) {
    await refreshTaste(ctx.db, ctx.userId);
    ctx.tasteFresh = true;
  }
  ctx.genres ??= await knownGenres(ctx.db, ctx.userId);
  const known = new Map(ctx.genres.map((g) => [g.toLowerCase(), g]));
  const unknown = [...(a.genres_any ?? []), ...(a.genres_none ?? [])].filter(
    (g) => !known.has(g.toLowerCase()),
  );
  const keep = (list: string[] | undefined) =>
    list?.flatMap((g) => {
      const name = known.get(g.toLowerCase());
      return name ? [name] : [];
    });

  const constraints: Constraints = {
    ...(a.available_minutes !== undefined && { availableMinutes: a.available_minutes }),
    ...(a.max_episodes_left !== undefined && { maxEpisodesLeft: a.max_episodes_left }),
    ...(a.genres_any?.length && { genresAny: keep(a.genres_any) ?? [] }),
    ...(a.genres_none?.length && { genresNone: keep(a.genres_none) ?? [] }),
    ...(a.media_types?.length && { mediaTypes: a.media_types }),
    ...(a.from?.length && { from: a.from }),
  };
  // Every genre they asked for was unknown: say so rather than filtering on nothing.
  if (a.genres_any?.length && !constraints.genresAny?.length) {
    return failure(
      "unknown_genres",
      `None of ${a.genres_any.join(", ")} is a genre on their list. Known genres: ${ctx.genres.join(", ")}.`,
    );
  }

  const ranked = rankCandidates(
    [...(await candidateRows(ctx.db, ctx.userId)), ...(await discoveryRows(ctx.db, ctx.userId))],
    await tasteSignals(ctx.db, ctx.userId),
    constraints,
  );
  const shown = ranked.slice(0, CANDIDATES_SHOWN);
  // Right after the first sync, the pool of new shows may still be building.
  const [built] = await ctx.db
    .select({ at: discoveryRuns.refreshedAt })
    .from(discoveryRuns)
    .where(eq(discoveryRuns.userId, ctx.userId));
  const searchedNew = !constraints.from || constraints.from.includes("new");
  for (const candidate of shown) ctx.offered.set(candidate.animeId, { candidate, constraints });

  return {
    result: {
      candidates: shown.map((c) => ({
        anime_id: c.animeId,
        title: c.title,
        ...(c.titleEn && c.titleEn !== c.title ? { english_title: c.titleEn } : {}),
        type: c.mediaType,
        ...(c.numEpisodes !== null && { episodes: c.numEpisodes }),
        list: c.pool,
        ...(c.minutesOver !== null && { minutes_over_their_time: c.minutesOver }),
        genres: c.genres,
        facts: c.facts,
      })),
      ...(ranked.length > shown.length && { more: ranked.length - shown.length }),
      ...(unknown.length > 0 && {
        note: `Ignored unknown genres: ${unknown.join(", ")}. Known genres: ${ctx.genres.join(", ")}.`,
      }),
      ...(searchedNew && !built
        ? {
            note: "New shows for them are still being gathered (about a minute after a sync); only their own list was searched.",
          }
        : ranked.length === 0 && {
            note: "Nothing fits all of that, on their list or among shows new to them.",
          }),
    },
  };
}

async function presentPicksTool(ctx: RecContext, raw: unknown): Promise<ToolOutcome> {
  const args = presentArgs.safeParse(raw);
  if (!args.success) {
    return failure("invalid_arguments", "Pass picks: a list of {anime_id, why}.");
  }
  const picks: Pick[] = [];
  const rejected: string[] = [];
  for (const p of args.data.picks) {
    const why = p.why.replace(/\s+/g, " ").trim();
    if (!ctx.offered.has(p.anime_id)) {
      rejected.push(`${String(p.anime_id)} wasn't returned by find_candidates`);
    } else if (picks.some((x) => x.animeId === p.anime_id)) {
      rejected.push(`${String(p.anime_id)} is picked twice`);
    } else if (why.length === 0 || why.length > MAX_WHY) {
      rejected.push(`${String(p.anime_id)} needs a reason of one short line`);
    } else if (picks.length < MAX_PICKS) {
      picks.push({ animeId: p.anime_id, why });
    }
  }
  if (picks.length === 0) {
    return failure("no_valid_picks", `Nothing to show: ${rejected.join("; ")}.`);
  }

  const constraints = Object.fromEntries(
    picks.map((p) => [String(p.animeId), ctx.offered.get(p.animeId)?.constraints ?? {}]),
  );
  // A new show needs a row to show as a card (and to be added from it).
  await rememberDiscovered(
    ctx.db,
    picks.filter((p) => ctx.offered.get(p.animeId)?.candidate.pool === "new").map((p) => p.animeId),
  );
  // Presenting again replaces the earlier picks of this run.
  const [row] = await ctx.db
    .insert(recommendations)
    .values({ userId: ctx.userId, runId: ctx.runId, picks, constraints })
    .onConflictDoUpdate({ target: recommendations.runId, set: { picks, constraints } })
    .returning({ id: recommendations.id });
  ctx.picks = picks;
  ctx.recommendationId = row?.id ?? null;
  return {
    result: {
      status: "shown",
      picks: picks.length,
      ...(rejected.length > 0 && { not_shown: rejected }),
      next: "Reply in one short sentence; the picks show as cards.",
    },
  };
}

function failure(error: string, message: string): ToolOutcome {
  return { result: { error, message }, error };
}
