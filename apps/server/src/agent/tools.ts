import { and, eq } from "drizzle-orm";
import { z } from "zod";

import type { Db } from "../db/client.js";
import { anime } from "../db/schema.js";
import { rememberShows } from "../anilist/catalog.js";
import type { CatalogShow } from "../anilist/client.js";
import { getEntry, searchCatalog, searchMyList, type ListEntryView } from "../list/search.js";
import type { ToolCall, ToolSpec } from "../llm/types.js";
import { MAL_LIST_STATUSES } from "../mal/client.js";
import {
  commitProposal,
  type Change,
  type CommitErrorCode,
  type ListWriter,
} from "../writes/commit.js";
import { DROP_CATEGORIES, MAX_DROP_SAID } from "../taste/dropReasons.js";
import type { ListChange } from "../writes/normalize.js";
import { proposeUpdate, type Proposal, type ProposeError } from "../writes/propose.js";
import { airingRows, latestAiredEpisode } from "../anilist/cache.js";
import { briefRule, mentionsWholeBrief, onlyNamedShows } from "./briefReply.js";
import { mentionsNewestEpisode } from "./newestEpisode.js";
import { mentionsNumber } from "./scoreGiven.js";
import type { ToolOutcome } from "./toolLoop.js";

/** Searches all anime by title (AniList in the app, a frozen catalog in evals). */
export type CatalogSearch = (queries: string[]) => Promise<CatalogShow[]>;

/** Per-run state the tools share. Grounding rules live here, not in the prompt. */
export interface RunContext {
  db: Db;
  userId: string;
  runId: string;
  writeListStatus: ListWriter;
  /** For search_anime; null when the prompt doesn't offer it. */
  catalog: CatalogSearch | null;
  /**
   * Anime ids a search or get_entry returned in this run. Only these can be proposed. A show not
   * on the list (from search_anime) becomes an add, which always waits for the user.
   */
  seen: Set<number>;
  /**
   * The latest aired episode of airing shows a search or get_entry returned, from the AniList
   * cache. Missing when unknown.
   */
  latestAired: Map<number, number>;
  /**
   * When the message replies to a morning brief: each show the brief listed and the episodes it
   * listed for it, ascending. Null otherwise.
   */
  briefEpisodes: Map<number, number[]> | null;
  /** The brief's shows the reply names by title or nickname (see agent/briefReply.ts namedShows). */
  briefNamed: Set<number>;
  /**
   * The titles the brief listed. In a reply to it, they count as the user's words for search:
   * the user is answering a message that named those shows.
   */
  briefTitles: string[];
  /** Anime ids a search marked as a clear match in this run, and why (see SearchCandidate). */
  clear: Map<number, "unique" | "only_in_progress">;
  /** Proposals created in this run. The model can only commit these. */
  proposalIds: Set<string>;
  committed: Change[];
  /** Why each commit the write path refused or MAL turned down failed, in order. */
  commitErrors: CommitErrorCode[];
  /** Proposals held for the user's confirmation; Chat shows each as a Confirm card. */
  pending: Proposal[];
  /** Held proposals the model has already been told are waiting for the user. */
  toldWaiting: Set<string>;
  /** The user's message, so search can tell their words from titles the model supplied. */
  userMessage: string;
  /**
   * Everything the user said that search may ground a match in: this message, their earlier
   * messages in the chat (never the agent's) and, in a reply to a brief, the brief's titles. A
   * title the model supplied only makes a show clear when these name it (see markClear).
   */
  groundIn: string[];
  /** Entries some search left tied; only the user's words can settle them (see markClear). */
  contested: Set<number>;
  /** The message answers the agent's own question ("which one?"). */
  answering: boolean;
  /** How often each exact search has run, to catch a model searching in circles. */
  searches: Map<string, number>;
  /** Set when the model keeps repeating itself; the run ends there. */
  stop: "repeated_commit" | "repeated_search" | "handoff" | null;
}

/** A model that runs the same search this many times is going in circles. */
const MAX_SAME_SEARCH = 3;

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
    name: "search_anime",
    description:
      "Search all anime, not just the user's list, by title: for a show they want to add, or say they watched, that isn't on their list. Pass the user's words plus official titles you know. Returns up to 5 shows, including matches on their list; on_your_list is set for shows they already have, which you update as usual; clear_match says whether the words clearly identify that show.",
    parameters: {
      type: "object",
      properties: {
        queries: {
          type: "array",
          items: { type: "string" },
          description: 'Title variants to look for, e.g. ["frieren", "Sousou no Frieren"]',
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
        drop_reason: {
          type: "string",
          enum: [...DROP_CATEGORIES],
          description:
            "Only with status dropped, and only when the user says why they're dropping it.",
        },
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
  {
    name: "recommend_shows",
    description:
      "The user wants a recommendation (what to watch next). Call this after any updates in the same message; the recommender then answers.",
    parameters: { type: "object", properties: {} },
  },
];

// Models sometimes send numbers as strings, or one query instead of a list: accept both.
const animeId = z.coerce.number().int().positive();
const searchArgs = z
  .object({ queries: z.array(z.string()).optional(), query: z.string().optional() })
  .transform((a) => [...(a.queries ?? []), ...(a.query ? [a.query] : [])]);
const getEntryArgs = z.object({ anime_id: animeId });
// Models sometimes send null for a field they mean to leave out. Null is "not given": z.coerce
// would make it 0, which clears a score or resets progress.
const optionalArg = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === null ? undefined : value), schema.optional());
// Strict: a misspelled field ("Episodes_watched") is an error the model can fix, not a field
// silently dropped from the change.
export const proposeArgs = z
  .object({
    anime_id: animeId,
    status: optionalArg(z.enum(MAL_LIST_STATUSES)),
    episodes_watched: optionalArg(z.coerce.number().int().nonnegative()),
    episodes_delta: optionalArg(z.coerce.number().int()),
    score: optionalArg(z.coerce.number().int().min(0).max(10)),
    is_rewatching: optionalArg(z.boolean()),
    drop_reason: optionalArg(z.enum(DROP_CATEGORIES)),
  })
  .strict();
const commitArgs = z.object({ proposal_id: z.uuid() });

/** Tools only offered to prompts that list them (see Prompt.tools in runAgent.ts). */
export const OPTIONAL_TOOLS = ["search_anime"] as const;
export type OptionalTool = (typeof OPTIONAL_TOOLS)[number];

/** The tools a prompt gets: the base set plus the optional ones it asks for. */
export function toolSpecsFor(extra: readonly OptionalTool[] = []): ToolSpec[] {
  return TOOL_SPECS.filter(
    (t) =>
      !(OPTIONAL_TOOLS as readonly string[]).includes(t.name) || extra.some((e) => e === t.name),
  );
}

export type { ToolOutcome } from "./toolLoop.js";

export async function executeTool(ctx: RunContext, call: ToolCall): Promise<ToolOutcome> {
  switch (call.name) {
    case "search_my_list":
      return searchTool(ctx, call.arguments);
    case "search_anime":
      return searchAnimeTool(ctx, call.arguments);
    case "get_entry":
      return getEntryTool(ctx, call.arguments);
    case "propose_update":
      return proposeTool(ctx, call.arguments);
    case "commit_update":
      return commitTool(ctx, call.arguments);
    case "recommend_shows":
      // The recommendation agent answers once this run ends (see chat/service.ts).
      ctx.stop = "handoff";
      return {
        result: {
          status: "handed_off",
          note: "The recommender answers this part. Stop here, and don't recommend anything yourself.",
        },
      };
    default:
      return failure("unknown_tool", `There is no tool named ${call.name}.`);
  }
}

async function searchTool(ctx: RunContext, raw: unknown): Promise<ToolOutcome> {
  const args = searchArgs.safeParse(raw);
  if (!args.success || args.data.length === 0) {
    return failure("invalid_arguments", "Pass queries: a list of title variants.");
  }
  const queries = args.data.slice(0, 4);
  const key = queries
    .map((q) => q.trim().toLowerCase())
    .sort()
    .join("|");
  const times = (ctx.searches.get(key) ?? 0) + 1;
  ctx.searches.set(key, times);
  if (times >= MAX_SAME_SEARCH) {
    ctx.stop = "repeated_search";
    return failure(
      "repeated_search",
      "This exact search already ran twice. Reply to the user now.",
    );
  }

  const candidates = await searchMyList(ctx.db, ctx.userId, queries, {
    userText:
      ctx.briefTitles.length > 0
        ? [ctx.userMessage, ...ctx.briefTitles].join("\n")
        : ctx.userMessage,
    groundIn: ctx.groundIn,
    contested: ctx.contested,
    answering: ctx.answering,
  });
  for (const c of candidates) {
    ctx.seen.add(c.animeId);
    // A later, sharper search can upgrade a tie-break match to a unique one, never downgrade.
    if (c.clearBy && ctx.clear.get(c.animeId) !== "unique") ctx.clear.set(c.animeId, c.clearBy);
  }
  if (candidates.length === 0) return { result: { results: [], note: "Not on the user's list." } };
  await noteLatestAired(
    ctx,
    candidates.map((c) => c.animeId),
  );
  return {
    result: {
      results: candidates.map((c) => ({ ...entryForModel(ctx, c), clear_match: c.clear })),
      ...(times > 1 && { note: "Same results as your earlier identical search." }),
    },
  };
}

/** Most search_anime results the model sees. */
const CATALOG_RESULTS = 5;

async function searchAnimeTool(ctx: RunContext, raw: unknown): Promise<ToolOutcome> {
  if (!ctx.catalog) return failure("unknown_tool", "There is no tool named search_anime.");
  const args = searchArgs.safeParse(raw);
  if (!args.success || args.data.length === 0) {
    return failure("invalid_arguments", "Pass queries: a list of title variants.");
  }
  const queries = args.data.slice(0, 3);
  const key = `anime:${queries
    .map((q) => q.trim().toLowerCase())
    .sort()
    .join("|")}`;
  const times = (ctx.searches.get(key) ?? 0) + 1;
  ctx.searches.set(key, times);
  if (times >= MAX_SAME_SEARCH) {
    ctx.stop = "repeated_search";
    return failure(
      "repeated_search",
      "This exact search already ran twice. Reply to the user now.",
    );
  }

  let found: CatalogShow[];
  try {
    found = await ctx.catalog(queries);
  } catch {
    return failure(
      "search_unavailable",
      "Searching beyond the user's list isn't working right now. Tell them, and don't add anything.",
    );
  }
  // Rows for these shows, so they can be shown and proposed. Shows without a MAL id can't be.
  const shows = await rememberShows(ctx.db, found);
  // The user's own entries by these names come along, scored with the rest, so a show they have
  // is found (and updated, not added) even when the model skipped search_my_list.
  const onList = await searchMyList(ctx.db, ctx.userId, queries, { limit: CATALOG_RESULTS });
  const candidates = await searchCatalog(
    ctx.db,
    ctx.userId,
    [...new Set([...onList.map((c) => c.animeId), ...shows.map((show) => show.malId)])],
    queries,
    {
      limit: CATALOG_RESULTS,
      userText: ctx.userMessage,
      groundIn: ctx.groundIn,
      contested: ctx.contested,
      answering: ctx.answering,
    },
  );
  for (const c of candidates) {
    ctx.seen.add(c.animeId);
    if (c.clearBy && ctx.clear.get(c.animeId) !== "unique") ctx.clear.set(c.animeId, c.clearBy);
  }
  if (candidates.length === 0) return { result: { results: [], note: "No anime by that name." } };
  return {
    result: {
      results: candidates.map((c) => ({
        anime_id: c.animeId,
        title: c.title,
        ...(c.titleEn && c.titleEn !== c.title && { title_english: c.titleEn }),
        media_type: c.mediaType,
        num_episodes: c.numEpisodes,
        airing: c.airingStatus,
        on_your_list:
          c.status === null ? null : { status: c.status, episodes_watched: c.episodesWatched },
        clear_match: c.clear,
      })),
      note: "Proposing a show that isn't on their list adds it. Every add waits for the user to confirm it.",
    },
  };
}

async function getEntryTool(ctx: RunContext, raw: unknown): Promise<ToolOutcome> {
  const args = getEntryArgs.safeParse(raw);
  if (!args.success) return failure("invalid_arguments", "Pass anime_id as an integer.");
  const entry = await getEntry(ctx.db, ctx.userId, args.data.anime_id);
  if (!entry) return failure("not_on_list", "That anime isn't on the user's list.");
  ctx.seen.add(entry.animeId);
  await noteLatestAired(ctx, [entry.animeId]);
  return { result: entryForModel(ctx, entry) };
}

async function proposeTool(ctx: RunContext, raw: unknown): Promise<ToolOutcome> {
  const args = proposeArgs.safeParse(raw);
  if (!args.success) {
    const unknown = args.error.issues.flatMap((issue) =>
      issue.code === "unrecognized_keys" ? issue.keys : [],
    );
    return failure(
      "invalid_arguments",
      unknown.length > 0
        ? `Unknown field ${unknown.join(", ")}. Use only anime_id, status, episodes_watched, episodes_delta, score and is_rewatching, spelled exactly so.`
        : "Check anime_id and the fields; see the tool schema.",
    );
  }
  const a = args.data;
  if (a.drop_reason !== undefined && a.status !== "dropped") {
    return failure("invalid_arguments", "drop_reason only goes with status dropped.");
  }
  if (!ctx.seen.has(a.anime_id)) {
    return failure(
      "unknown_anime",
      "Search for the show first; only use anime_id values returned by search_my_list, search_anime or get_entry.",
    );
  }
  const result = await proposeUpdate(ctx.db, {
    userId: ctx.userId,
    runId: ctx.runId,
    animeId: a.anime_id,
    clearMatch: isClearFor(ctx.clear.get(a.anime_id), a),
    ...briefOrNewest(ctx, a.anime_id),
    noNumberGiven: !mentionsNumber(ctx.userMessage),
    ...(a.status !== undefined && { status: a.status }),
    ...(a.episodes_watched !== undefined && { episodesWatched: a.episodes_watched }),
    ...(a.episodes_delta !== undefined && { episodesDelta: a.episodes_delta }),
    ...(a.score !== undefined && { score: a.score }),
    ...(a.is_rewatching !== undefined && { isRewatching: a.is_rewatching }),
    // The category is the model's; the words are always the user's own message.
    ...(a.drop_reason !== undefined && {
      dropReason: { category: a.drop_reason, said: ctx.userMessage.slice(0, MAX_DROP_SAID) },
    }),
  });
  if (!result.ok) return failure(result.error, await explain(ctx, result.error, a.anime_id));

  const p = result.proposal;
  ctx.proposalIds.add(p.id);
  if (p.requiresConfirmation) {
    // Held from the moment it's proposed: Chat shows it as a Confirm card either way.
    if (!ctx.pending.some((held) => held.id === p.id)) ctx.pending.push(p);
    return {
      result: {
        proposal_id: p.id,
        change: changeForModel(p.change),
        requires_confirmation: true,
        ...(p.confirmationReason ? { reason: p.confirmationReason } : {}),
        next:
          p.kind === "add"
            ? "This adds the show to their list, so the user will see an Add button for it. Don't commit it; tell them to tap Add."
            : "The user will see a Confirm button for this change. Don't commit it; tell them it needs their confirmation.",
      },
    };
  }
  return {
    result: {
      proposal_id: p.id,
      change: changeForModel(p.change),
      requires_confirmation: false,
      next: "Call commit_update with this proposal_id to write it.",
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
      // Asking again can't change the answer; a model stuck doing so would burn every turn.
      if (ctx.toldWaiting.has(id)) ctx.stop = "repeated_commit";
      ctx.toldWaiting.add(id);
      return {
        result: {
          status: "waiting_for_user_confirmation",
          note: "Don't call commit_update for this again. Tell the user this change needs their confirmation.",
        },
      };
    case "failed":
      ctx.commitErrors.push(result.error);
      return failure(result.error, "The change was not written.");
    default:
      return failure(result.status, "The change was not written.");
  }
}

/**
 * A unique match is clear for any change. A match that only won a tie by being the one show in
 * progress is clear only for forward progress (episodes, or starting/finishing it): "finished
 * frieren" means the season being watched, but "dropping the isekai one" among several isekai
 * shows must ask first, as the design says.
 */
function isClearFor(
  clearBy: "unique" | "only_in_progress" | undefined,
  change: z.infer<typeof proposeArgs>,
): boolean {
  if (clearBy === "unique") return true;
  if (clearBy !== "only_in_progress") return false;
  const forwardStatus =
    change.status === undefined || change.status === "watching" || change.status === "completed";
  const progress =
    change.episodes_watched !== undefined ||
    change.episodes_delta !== undefined ||
    change.status !== undefined;
  return (
    progress && forwardStatus && change.score === undefined && change.is_rewatching === undefined
  );
}

/**
 * What a vague episode reference pins progress to. Right after a brief, the brief's rules apply
 * to the shows it listed (see agent/briefReply.ts); "watched it" can't touch a show it didn't
 * list. They win over "the newest episode", since more may have aired since the brief.
 * Otherwise "the newest episode" means the latest aired one.
 */
function briefOrNewest(ctx: RunContext, animeId: number) {
  if (ctx.briefEpisodes) {
    const listed = ctx.briefEpisodes.get(animeId);
    if (listed) {
      const rule = briefRule(ctx.userMessage);
      // "watched daemons and clevatess" only covers those two, whichever shows the model picks.
      const unnamed =
        onlyNamedShows(ctx.userMessage, rule) &&
        ctx.briefNamed.size > 0 &&
        !ctx.briefNamed.has(animeId);
      return { briefReply: { listed, rule: unnamed ? ({ kind: "unnamed" } as const) : rule } };
    }
    if (mentionsWholeBrief(ctx.userMessage)) {
      return { briefReply: { listed: [], rule: { kind: "last" } as const } };
    }
  }
  if (mentionsNewestEpisode(ctx.userMessage)) {
    return { newestEpisode: { latestAired: ctx.latestAired.get(animeId) ?? null } };
  }
  return {};
}

/**
 * Records the latest aired episode of the airing shows among these entries, from the AniList
 * cache (refreshed by list syncs and the daily brief). The agent never calls AniList itself.
 */
async function noteLatestAired(ctx: RunContext, animeIds: number[]): Promise<void> {
  const now = new Date();
  for (const row of (await airingRows(ctx.db, animeIds)).values()) {
    if (row.status === "FINISHED") continue;
    const latest = latestAiredEpisode(row, now);
    if (latest !== null) ctx.latestAired.set(row.malId, latest);
  }
}

function entryForModel(ctx: RunContext, entry: ListEntryView) {
  const latest = ctx.latestAired.get(entry.animeId);
  return {
    anime_id: entry.animeId,
    title: entry.title,
    ...(entry.titleEn && entry.titleEn !== entry.title ? { english_title: entry.titleEn } : {}),
    type: entry.mediaType,
    status: entry.status,
    episodes_watched: entry.episodesWatched,
    total_episodes: entry.numEpisodes ?? "unknown",
    ...(entry.airingStatus ? { airing_status: entry.airingStatus } : {}),
    ...(latest !== undefined ? { latest_aired_episode: latest } : {}),
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
    case "unknown_anime":
      return "That show wasn't found; search for it first.";
    case "both_episode_forms":
      return "Use either episodes_watched or episodes_delta, not both.";
    case "no_change_requested":
      return "Say what to change: status, episodes, score or rewatching.";
    case "rewatch_not_completed":
      return "Rewatching is only for a show they've completed. For a show they haven't finished, starting it (again) means episodes_watched = 1.";
    default:
      return "Those values aren't valid.";
  }
}

function failure(error: string, message: string): ToolOutcome {
  return { result: { error, message }, error };
}
