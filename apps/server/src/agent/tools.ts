import { and, eq } from "drizzle-orm";
import { z } from "zod";

import type { Db } from "../db/client.js";
import { anime } from "../db/schema.js";
import { getEntry, searchMyList, type ListEntryView } from "../list/search.js";
import type { ToolCall, ToolSpec } from "../llm/types.js";
import { MAL_LIST_STATUSES } from "../mal/client.js";
import { commitProposal, type Change, type ListWriter } from "../writes/commit.js";
import type { ListChange } from "../writes/normalize.js";
import { proposeUpdate, type Proposal, type ProposeError } from "../writes/propose.js";

/** Per-run state the tools share. Grounding rules live here, not in the prompt. */
export interface RunContext {
  db: Db;
  userId: string;
  runId: string;
  writeListStatus: ListWriter;
  /** Anime ids a search or get_entry returned in this run. Only these can be proposed. */
  seen: Set<number>;
  /** Anime ids a search marked as a clear match in this run. */
  clear: Set<number>;
  /** Proposals created in this run. The model can only commit these. */
  proposalIds: Set<string>;
  committed: Change[];
  pending: Proposal[];
}

export const TOOL_SPECS: ToolSpec[] = [
  {
    name: "search_my_list",
    description:
      "Search the user's anime list. Pass the user's words plus any official, English or abbreviated titles you know. Returns up to 5 entries; clear_match says whether the words clearly identify that entry.",
    parameters: {
      type: "object",
      properties: {
        queries: {
          type: "array",
          items: { type: "string" },
          description: 'Title variants to look for, e.g. ["jjk", "Jujutsu Kaisen"]',
        },
      },
      required: ["queries"],
    },
  },
  {
    name: "get_entry",
    description: "Get one entry on the user's list by anime_id.",
    parameters: {
      type: "object",
      properties: { anime_id: { type: "integer" } },
      required: ["anime_id"],
    },
  },
  {
    name: "propose_update",
    description:
      "Stage a change to one entry. Set only what the user said. Use episodes_delta for relative progress ('two more'). Returns a proposal_id to commit.",
    parameters: {
      type: "object",
      properties: {
        anime_id: { type: "integer" },
        status: { type: "string", enum: [...MAL_LIST_STATUSES] },
        episodes_watched: { type: "integer", description: "Episode count after this update" },
        episodes_delta: { type: "integer", description: "Episodes watched since last time" },
        score: { type: "integer", description: "1-10" },
        is_rewatching: { type: "boolean" },
      },
      required: ["anime_id"],
    },
  },
  {
    name: "commit_update",
    description: "Write a staged proposal to the user's MyAnimeList.",
    parameters: {
      type: "object",
      properties: { proposal_id: { type: "string" } },
      required: ["proposal_id"],
    },
  },
];

// Models sometimes send numbers as strings, or one query instead of a list: accept both.
const animeId = z.coerce.number().int().positive();
const searchArgs = z
  .object({ queries: z.array(z.string()).optional(), query: z.string().optional() })
  .transform((a) => [...(a.queries ?? []), ...(a.query ? [a.query] : [])]);
const getEntryArgs = z.object({ anime_id: animeId });
const proposeArgs = z.object({
  anime_id: animeId,
  status: z.enum(MAL_LIST_STATUSES).optional(),
  episodes_watched: z.coerce.number().int().nonnegative().optional(),
  episodes_delta: z.coerce.number().int().optional(),
  score: z.coerce.number().int().min(0).max(10).optional(),
  is_rewatching: z.boolean().optional(),
});
const commitArgs = z.object({ proposal_id: z.uuid() });

export interface ToolOutcome {
  /** Sent back to the model as JSON. */
  result: unknown;
  /** Set when the call failed, for the run log. */
  error?: string;
}

export async function executeTool(ctx: RunContext, call: ToolCall): Promise<ToolOutcome> {
  switch (call.name) {
    case "search_my_list":
      return searchTool(ctx, call.arguments);
    case "get_entry":
      return getEntryTool(ctx, call.arguments);
    case "propose_update":
      return proposeTool(ctx, call.arguments);
    case "commit_update":
      return commitTool(ctx, call.arguments);
    default:
      return failure("unknown_tool", `There is no tool named ${call.name}.`);
  }
}

async function searchTool(ctx: RunContext, raw: unknown): Promise<ToolOutcome> {
  const args = searchArgs.safeParse(raw);
  if (!args.success || args.data.length === 0) {
    return failure("invalid_arguments", "Pass queries: a list of title variants.");
  }
  const candidates = await searchMyList(ctx.db, ctx.userId, args.data.slice(0, 4));
  for (const c of candidates) {
    ctx.seen.add(c.animeId);
    if (c.clear) ctx.clear.add(c.animeId);
  }
  if (candidates.length === 0) return { result: { results: [], note: "Not on the user's list." } };
  return {
    result: { results: candidates.map((c) => ({ ...entryForModel(c), clear_match: c.clear })) },
  };
}

async function getEntryTool(ctx: RunContext, raw: unknown): Promise<ToolOutcome> {
  const args = getEntryArgs.safeParse(raw);
  if (!args.success) return failure("invalid_arguments", "Pass anime_id as an integer.");
  const entry = await getEntry(ctx.db, ctx.userId, args.data.anime_id);
  if (!entry) return failure("not_on_list", "That anime isn't on the user's list.");
  ctx.seen.add(entry.animeId);
  return { result: entryForModel(entry) };
}

async function proposeTool(ctx: RunContext, raw: unknown): Promise<ToolOutcome> {
  const args = proposeArgs.safeParse(raw);
  if (!args.success) {
    return failure("invalid_arguments", "Check anime_id and the fields; see the tool schema.");
  }
  const a = args.data;
  if (!ctx.seen.has(a.anime_id)) {
    return failure(
      "unknown_anime",
      "Search for the show first; only use anime_id values returned by search_my_list or get_entry.",
    );
  }
  const result = await proposeUpdate(ctx.db, {
    userId: ctx.userId,
    runId: ctx.runId,
    animeId: a.anime_id,
    clearMatch: ctx.clear.has(a.anime_id),
    ...(a.status !== undefined && { status: a.status }),
    ...(a.episodes_watched !== undefined && { episodesWatched: a.episodes_watched }),
    ...(a.episodes_delta !== undefined && { episodesDelta: a.episodes_delta }),
    ...(a.score !== undefined && { score: a.score }),
    ...(a.is_rewatching !== undefined && { isRewatching: a.is_rewatching }),
  });
  if (!result.ok) return failure(result.error, await explain(ctx, result.error, a.anime_id));

  const p = result.proposal;
  ctx.proposalIds.add(p.id);
  return {
    result: {
      proposal_id: p.id,
      change: changeForModel(p.change),
      requires_confirmation: p.requiresConfirmation,
      ...(p.confirmationReason ? { reason: p.confirmationReason } : {}),
    },
  };
}

async function commitTool(ctx: RunContext, raw: unknown): Promise<ToolOutcome> {
  const args = commitArgs.safeParse(raw);
  if (!args.success)
    return failure("invalid_arguments", "Pass the proposal_id from propose_update.");
  const id = args.data.proposal_id;
  if (!ctx.proposalIds.has(id)) {
    return failure("unknown_proposal", "Only commit a proposal_id that propose_update returned.");
  }

  const result = await commitProposal(
    { db: ctx.db, writeListStatus: ctx.writeListStatus },
    ctx.userId,
    id,
  );
  switch (result.status) {
    case "committed":
      if (!result.alreadyCommitted) ctx.committed.push(result.change);
      return { result: { status: "committed", change: changeForModel(result.change.after) } };
    case "needs_confirmation":
      if (!ctx.pending.some((p) => p.id === id)) ctx.pending.push(result.proposal);
      return {
        result: {
          status: "waiting_for_user_confirmation",
          note: "Tell the user this change needs their confirmation.",
        },
      };
    case "failed":
      return failure(result.error, "The change was not written.");
    default:
      return failure(result.status, "The change was not written.");
  }
}

function entryForModel(entry: ListEntryView) {
  return {
    anime_id: entry.animeId,
    title: entry.title,
    ...(entry.titleEn && entry.titleEn !== entry.title ? { english_title: entry.titleEn } : {}),
    type: entry.mediaType,
    status: entry.status,
    episodes_watched: entry.episodesWatched,
    total_episodes: entry.numEpisodes ?? "unknown",
    ...(entry.score > 0 ? { score: entry.score } : {}),
    ...(entry.isRewatching ? { rewatching: true } : {}),
  };
}

function changeForModel(change: ListChange) {
  return {
    ...(change.status !== undefined && { status: change.status }),
    ...(change.episodesWatched !== undefined && { episodes_watched: change.episodesWatched }),
    ...(change.score !== undefined && { score: change.score }),
    ...(change.isRewatching !== undefined && { is_rewatching: change.isRewatching }),
  };
}

async function explain(ctx: RunContext, error: ProposeError, id: number): Promise<string> {
  switch (error) {
    case "episodes_exceed_total": {
      const [row] = await ctx.db
        .select({ total: anime.numEpisodes })
        .from(anime)
        .where(and(eq(anime.malId, id)));
      return `That is more episodes than the show has (${String(row?.total ?? "?")}).`;
    }
    case "no_change":
      return "The list already has these values; nothing to change.";
    case "not_on_list":
      return "That anime isn't on the user's list.";
    case "both_episode_forms":
      return "Use either episodes_watched or episodes_delta, not both.";
    case "no_change_requested":
      return "Say what to change: status, episodes, score or rewatching.";
    default:
      return "Those values aren't valid.";
  }
}

function failure(error: string, message: string): ToolOutcome {
  return { result: { error, message }, error };
}
