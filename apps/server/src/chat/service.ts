import type { BriefCardView, RunView } from "@kurisu/shared";
import { and, desc, eq, inArray, max, sql } from "drizzle-orm";

import { claimsChange, NOTHING_CHANGED_REPLY } from "../agent/claims.js";
import { runAgent, type AgentDeps, type Prompt, type RunResult } from "../agent/runAgent.js";
import type { Db, Executor } from "../db/client.js";
import { watchOn } from "../brief/services.js";
import {
  agentRuns,
  anilistCatalog,
  anilistMedia,
  anime,
  briefSettings,
  briefs,
  changes,
  chatMessages,
  conversations,
  listEntries,
  proposals,
  recommendations,
} from "../db/schema.js";
import type { ModelRef } from "../llm/modelConfig.js";
import { runRecommender, type RecommendResult } from "../recommend/agent.js";
import type { AnimeRefresher, CommitErrorCode, ListRemover } from "../writes/commit.js";
import type { ListChange } from "../writes/normalize.js";
import { mentionedShows } from "./mentions.js";
import { loadBriefCards, loadRunViews } from "./runs.js";
import { titleFrom, UNTITLED_CHAT } from "./titles.js";

export interface ChatDeps extends AgentDeps {
  /** For undoing an add, from the change cards. */
  removeListStatus?: ListRemover;
  /** Fills in MAL's details for a show once it's added. */
  refreshAnime?: AnimeRefresher;
  roles: { agent: ModelRef; escalation: ModelRef | null; recommend: ModelRef };
  /** The recommendation agent's prompt. */
  recommendPrompt: Prompt;
  /**
   * Reads a message for reactions to the shows it updated and saves them to the diary, in the
   * background (see diary/reader.ts). Never throws.
   */
  diary?: (
    userId: string,
    message: string,
    committed: { animeId: number; changeId: string }[],
  ) => void;
}

/** Earlier messages the model sees for context. */
const HISTORY_MESSAGES = 6;

export interface ChangeView {
  id: string;
  proposalId: string;
  animeId: number;
  title: string;
  pictureUrl: string | null;
  numEpisodes: number | null;
  kind: "update" | "add" | "remove";
  before: ListChange;
  after: ListChange;
  committedAt: string;
  undone: boolean;
  isUndo: boolean;
  /** Who made it: the agent, the user on the List screen, an import, or an undo. */
  source: "agent" | "user" | "import" | "undo";
}

export interface PendingView {
  id: string;
  animeId: number;
  title: string;
  kind: "update" | "add";
  before: ListChange;
  change: ListChange;
  reason: string | null;
  /** The show, for an add's card. */
  show: ShowCardView | null;
}

/** A chat, as listed in the sidebar. */
export interface ConversationView {
  id: string;
  title: string;
  lastMessageAt: string;
  /** A chat a morning brief started. */
  isBrief: boolean;
}

/** The chat doesn't exist, or isn't the user's. */
export class ConversationNotFoundError extends Error {
  constructor() {
    super("conversation not found");
    this.name = "ConversationNotFoundError";
  }
}

export interface ChatMessageView {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  changes: ChangeView[];
  pending: PendingView[];
  picks: PickView[];
  /** Shows the reply names that have no other card in it. */
  shows: ShowCardView[];
  /** The reply asks a question, so its show cards answer it when tapped. */
  asksToChoose: boolean;
  /** The runs behind an assistant reply (RunMeta and its trace). */
  run: RunView | null;
  /** A brief's message: its card. */
  brief: BriefCardView | null;
}

/** A show a reply names, as a card. `status` is null when it isn't on the user's list. */
export interface ShowCardView {
  animeId: number;
  title: string;
  pictureUrl: string | null;
  mediaType: string | null;
  numEpisodes: number | null;
  episodeMinutes: number | null;
  status: string | null;
  episodesWatched: number;
}

/** A recommended show, as a card under the reply. `status` is null for a show new to the user. */
export interface PickView {
  animeId: number;
  title: string;
  pictureUrl: string | null;
  status: string | null;
  episodesWatched: number;
  numEpisodes: number | null;
  episodeMinutes: number | null;
  why: string;
}

/**
 * Handles one user message in a chat, or in a new chat titled after it when `conversationId` is
 * null. Runs the agent on the configured model and, if that run ended without writing anything
 * because it had to ask, hold a change, or failed, retries once on the escalation model. The
 * escalated answer replaces the first only if it succeeds. Throws ConversationNotFoundError for a
 * chat that isn't the user's.
 */
export async function handleChatMessage(
  deps: ChatDeps,
  userId: string,
  text: string,
  existingConversationId: string | null,
): Promise<{
  conversationId: string;
  userMessageId: string;
  assistantMessageId: string;
  run: RunResult;
  recommendation: RecommendResult | null;
}> {
  const { db } = deps;
  if (existingConversationId && !(await findConversation(db, userId, existingConversationId))) {
    throw new ConversationNotFoundError();
  }
  const recent = existingConversationId
    ? (
        await db
          .select({ id: chatMessages.id, role: chatMessages.role, content: chatMessages.content })
          .from(chatMessages)
          .where(eq(chatMessages.conversationId, existingConversationId))
          .orderBy(desc(chatMessages.createdAt))
          .limit(HISTORY_MESSAGES)
      ).reverse()
    : [];
  const history = recent.map(({ role, content }) => ({ role, content }));
  const brief = await briefRepliedTo(db, recent.at(-1));

  const { conversationId, userMessageId } = await db.transaction(async (tx) => {
    const id = existingConversationId ?? (await createConversation(tx, userId, titleFrom(text)));
    const [message] = await tx
      .insert(chatMessages)
      .values({ conversationId: id, role: "user", content: text })
      .returning({ id: chatMessages.id });
    if (!message) throw new Error("chat message insert returned no row");
    return { conversationId: id, userMessageId: message.id };
  });

  const input = { userId, conversationId, history, message: text, ...(brief && { brief }) };
  let run = await runAgent(deps, { ...input, model: deps.roles.agent });

  const escalation = deps.roles.escalation;
  // A held add waits for the user by design; a stronger model can't do better.
  const onlyAddsHeld = run.pending.length > 0 && run.pending.every((p) => p.kind === "add");
  const worthEscalating =
    !run.handedOff &&
    !onlyAddsHeld &&
    run.committed.length === 0 &&
    ["clarification", "needs_confirmation", "error"].includes(run.outcome) &&
    run.error !== "model_auth";
  if (escalation && escalation.ref !== deps.roles.agent.ref && worthEscalating) {
    const second = await runAgent(deps, {
      ...input,
      model: escalation,
      escalatedFromRunId: run.runId,
    });
    if (second.outcome !== "error") {
      // The first run's held proposals are superseded by the escalated answer.
      if (run.pending.length > 0) {
        await db
          .update(proposals)
          .set({ status: "cancelled", updatedAt: new Date() })
          .where(
            and(
              inArray(
                proposals.id,
                run.pending.map((p) => p.id),
              ),
              eq(proposals.status, "pending"),
            ),
          );
      }
      run = second;
    }
  }

  // Reactions to the shows it updated go to the diary, apart from the writes and the reply.
  if (run.committed.length > 0) {
    deps.diary?.(
      userId,
      text,
      run.committed.map((c) => ({ animeId: c.animeId, changeId: c.id })),
    );
  }

  // The progress agent handed a recommendation request over: the recommender answers it,
  // after any updates in the same message.
  let recommendation: RecommendResult | null = null;
  if (run.handedOff) {
    recommendation = await runRecommender(
      { db, models: deps.models, prompt: deps.recommendPrompt },
      { ...input, model: deps.roles.recommend, handedOffFromRunId: run.runId },
    );
  }

  const content = combinedReply(run, recommendation);
  // Shows the reply names get cards, unless a change, Confirm or pick card already shows them.
  const carded = new Set([
    ...run.committed.map((c) => c.animeId),
    ...run.pending.map((p) => p.animeId),
    ...(recommendation?.picks.map((p) => p.animeId) ?? []),
  ]);
  const showIds = await mentionedShows(
    db,
    content,
    run.lookedUp.filter((id) => !carded.has(id)),
  );
  const [assistantMessage] = await db
    .insert(chatMessages)
    .values({ conversationId, role: "assistant", content, runId: run.runId, showIds })
    .returning({ id: chatMessages.id });
  if (!assistantMessage) throw new Error("chat message insert returned no row");
  if (recommendation?.recommendationId) {
    await db
      .update(recommendations)
      .set({ chatMessageId: assistantMessage.id })
      .where(eq(recommendations.id, recommendation.recommendationId));
  }

  return {
    conversationId,
    userMessageId,
    assistantMessageId: assistantMessage.id,
    run,
    recommendation,
  };
}

/** The progress agent's reply about any changes, then the recommender's, when there was one. */
function combinedReply(run: RunResult, recommendation: RecommendResult | null): string {
  if (!recommendation) return replyFor(run);
  const parts: string[] = [];
  if (run.committed.length > 0 || run.pending.length > 0) parts.push(replyFor(run));
  parts.push(
    recommendation.outcome === "error" ? errorReply(recommendation.error) : recommendation.reply,
  );
  return parts.filter((part) => part.length > 0).join("\n\n") || "Done.";
}

/**
 * What the user sees. A reply must never claim a change that didn't happen: if the run
 * committed and held nothing but the text says something changed, it's replaced with an honest
 * message (the model's original text stays in agent_run_steps). If a commit failed, that message
 * says why, since the agent understood the user and asking them to repeat it would mislead.
 */
function replyFor(run: RunResult): string {
  if (run.outcome === "error") return errorReply(run.error);
  const wroteNothing = run.committed.length === 0 && run.pending.length === 0;
  if (wroteNothing && !run.asked && claimsChange(run.reply)) {
    const failed = run.commitErrors.at(-1);
    return failed ? commitFailedReply(failed) : NOTHING_CHANGED_REPLY;
  }
  return run.reply || "Done.";
}

/** Worded like the web's messages for a failed confirm or undo. */
function commitFailedReply(error: CommitErrorCode): string {
  switch (error) {
    case "reauth_required":
      return "MyAnimeList needs you to log in again before I can change your list.";
    case "mal_rejected":
      return "MyAnimeList didn't accept the change, so your list is unchanged. Try again in a minute.";
    case "mal_unavailable":
      return "I couldn't reach MyAnimeList, so your list is unchanged. Try again in a minute.";
    case "stale":
      return "Your list changed while I was updating it, so I left it alone. Tell me again and I'll redo it.";
    default:
      return "Something went wrong saving that, so your list is unchanged. Try again in a minute.";
  }
}

function errorReply(error: string | null): string {
  switch (error) {
    case "model_auth":
      return "The chat model isn't set up yet: add GEMINI_API_KEY to .env.local and restart the server.";
    case "model_rate_limited":
      return "The model's free quota is used up for now. Please try again later.";
    case "model_unavailable":
      return "I couldn't reach the model. Please try again in a moment.";
    default:
      return "Sorry, I got stuck on that one. Could you rephrase it?";
  }
}

/**
 * The morning brief a message replies to, if the conversation's last message is one: each show
 * and the episodes it listed.
 */
async function briefRepliedTo(
  db: Db,
  last: { id: string; role: "user" | "assistant" } | undefined,
): Promise<{ malId: number; episodes: number[] }[] | null> {
  if (last?.role !== "assistant") return null;
  const [row] = await db
    .select({ items: briefs.items })
    .from(briefs)
    .where(eq(briefs.chatMessageId, last.id))
    .limit(1);
  if (!row?.items?.length) return null;
  return row.items.map((item) => ({ malId: item.malId, episodes: item.episodes }));
}

/** Starts a chat. */
export async function createConversation(
  db: Executor,
  userId: string,
  title: string,
): Promise<string> {
  const [created] = await db
    .insert(conversations)
    .values({ userId, title })
    .returning({ id: conversations.id });
  if (!created) throw new Error("conversation insert returned no row");
  return created.id;
}

/**
 * The user's chats, most recently active first. A chat from before titles existed is called
 * after the user's first message in it.
 */
export async function listConversations(
  db: Db,
  userId: string,
  options: { id?: string; limit?: number } = {},
): Promise<ConversationView[]> {
  const lastMessageAt = sql<Date>`coalesce(${max(chatMessages.createdAt)}, ${conversations.createdAt})`;
  const rows = await db
    .select({
      id: conversations.id,
      title: conversations.title,
      firstMessage: sql<string | null>`(
        select m.content from chat_messages m
        where m.conversation_id = ${conversations.id} and m.role = 'user'
        order by m.created_at limit 1
      )`,
      lastMessageAt: lastMessageAt.mapWith(conversations.createdAt),
      isBrief: sql<boolean>`exists (
        select 1 from briefs b join chat_messages bm on bm.id = b.chat_message_id
        where bm.conversation_id = ${conversations.id}
      )`,
    })
    .from(conversations)
    .leftJoin(chatMessages, eq(chatMessages.conversationId, conversations.id))
    .where(
      and(
        eq(conversations.userId, userId),
        ...(options.id ? [eq(conversations.id, options.id)] : []),
      ),
    )
    .groupBy(conversations.id)
    .orderBy(desc(lastMessageAt), desc(conversations.id))
    .limit(options.limit ?? 100);
  return rows.map((row) => ({
    id: row.id,
    title: row.title ?? (row.firstMessage ? titleFrom(row.firstMessage) : UNTITLED_CHAT),
    lastMessageAt: row.lastMessageAt.toISOString(),
    isBrief: row.isBrief,
  }));
}

/** The user's chat with this id, or null if they have none. */
export async function findConversation(
  db: Db,
  userId: string,
  id: string,
): Promise<ConversationView | null> {
  const [conversation] = await listConversations(db, userId, { id, limit: 1 });
  return conversation ?? null;
}

/**
 * Deletes one of the user's chats and its messages. Changes it held for confirmation are
 * cancelled, since nothing else shows them; changes it made stay in the change log, where they
 * can still be undone. Returns false if the user has no such chat.
 */
/** Renames one of the user's chats. Returns null if they have no such chat. */
export async function renameConversation(
  db: Db,
  userId: string,
  id: string,
  title: string,
): Promise<ConversationView | null> {
  const renamed = await db
    .update(conversations)
    .set({ title })
    .where(and(eq(conversations.id, id), eq(conversations.userId, userId)))
    .returning({ id: conversations.id });
  return renamed.length > 0 ? findConversation(db, userId, id) : null;
}

export async function deleteConversation(db: Db, userId: string, id: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    const runs = tx
      .select({ id: agentRuns.id })
      .from(agentRuns)
      .where(and(eq(agentRuns.conversationId, id), eq(agentRuns.userId, userId)));
    await tx
      .update(proposals)
      .set({ status: "cancelled", updatedAt: new Date() })
      .where(
        and(
          eq(proposals.userId, userId),
          inArray(proposals.runId, runs),
          eq(proposals.status, "pending"),
        ),
      );
    const deleted = await tx
      .delete(conversations)
      .where(and(eq(conversations.id, id), eq(conversations.userId, userId)))
      .returning({ id: conversations.id });
    return deleted.length > 0;
  });
}

/** One of the user's chats: its messages, oldest first, each with the changes it made. */
export async function loadThread(
  db: Db,
  userId: string,
  conversationId: string,
  limit = 50,
  onlyIds?: string[],
): Promise<ChatMessageView[]> {
  const rows = (
    await db
      .select({
        id: chatMessages.id,
        role: chatMessages.role,
        content: chatMessages.content,
        runId: chatMessages.runId,
        showIds: chatMessages.showIds,
        createdAt: chatMessages.createdAt,
      })
      .from(chatMessages)
      .innerJoin(conversations, eq(chatMessages.conversationId, conversations.id))
      .where(
        and(
          eq(chatMessages.conversationId, conversationId),
          eq(conversations.userId, userId),
          ...(onlyIds ? [inArray(chatMessages.id, onlyIds)] : []),
        ),
      )
      .orderBy(desc(chatMessages.createdAt))
      .limit(limit)
  ).reverse();

  const runIds = rows.map((r) => r.runId).filter((id): id is string => id !== null);
  const cards =
    runIds.length === 0
      ? []
      : await db
          .select({
            proposal: proposals,
            show: {
              title: anime.title,
              pictureUrl: anime.mainPictureUrl,
              numEpisodes: anime.numEpisodes,
            },
            change: changes,
          })
          .from(proposals)
          .innerJoin(anime, eq(proposals.animeId, anime.malId))
          .leftJoin(changes, eq(changes.proposalId, proposals.id))
          .where(
            and(
              eq(proposals.userId, userId),
              inArray(proposals.runId, runIds),
              inArray(proposals.status, ["pending", "committed"]),
            ),
          );

  const picksByMessage = await loadPicks(
    db,
    userId,
    rows.map((r) => r.id),
  );
  const runViews = await loadRunViews(db, runIds);
  const briefCards = await loadBriefCards(
    db,
    rows.filter((r) => r.role === "assistant" && r.runId === null).map((r) => r.id),
  );
  const showCards = await loadShowCards(db, userId, [
    ...rows.flatMap((r) => r.showIds),
    ...cards.filter((c) => c.proposal.kind === "add").map((c) => c.proposal.animeId),
  ]);

  return rows.map((row) => {
    const mine = cards.filter((c) => c.proposal.runId === row.runId);
    return {
      id: row.id,
      role: row.role,
      content: row.content,
      createdAt: row.createdAt.toISOString(),
      changes: mine.flatMap((c) =>
        c.change ? [toChangeView(c.change, c.show, c.proposal.source)] : [],
      ),
      pending: mine
        .filter((c) => c.proposal.status === "pending" && c.proposal.requiresConfirmation)
        .map((c) => {
          const add = c.proposal.kind === "add";
          return {
            id: c.proposal.id,
            animeId: c.proposal.animeId,
            title: c.show.title,
            kind: add ? ("add" as const) : ("update" as const),
            before: c.proposal.before ? pickChanged(c.proposal.before, c.proposal.change) : {},
            change: c.proposal.change,
            reason: c.proposal.confirmationReason,
            show: add ? (showCards.get(c.proposal.animeId) ?? null) : null,
          };
        }),
      picks: picksByMessage.get(row.id) ?? [],
      shows: row.showIds.flatMap((id) => {
        const card = showCards.get(id);
        return card ? [card] : [];
      }),
      asksToChoose: row.role === "assistant" && row.showIds.length > 0 && row.content.includes("?"),
      run: row.runId ? (runViews.get(row.runId) ?? null) : null,
      brief: briefCards.get(row.id) ?? null,
    };
  });
}

/** Cards for these shows: what MAL says about each, and where the user is in it, if anywhere. */
export async function loadShowCards(
  db: Db,
  userId: string,
  animeIds: number[],
): Promise<Map<number, ShowCardView>> {
  const ids = [...new Set(animeIds)];
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({
      animeId: anime.malId,
      title: anime.title,
      pictureUrl: anime.mainPictureUrl,
      mediaType: anime.mediaType,
      numEpisodes: anime.numEpisodes,
      episodeMinutes: anime.episodeMinutes,
      status: listEntries.status,
      episodesWatched: listEntries.numEpisodesWatched,
    })
    .from(anime)
    .leftJoin(
      listEntries,
      and(eq(listEntries.animeId, anime.malId), eq(listEntries.userId, userId)),
    )
    .where(inArray(anime.malId, ids));
  return new Map(
    rows.map((r) => [r.animeId, { ...r, episodesWatched: r.episodesWatched ?? 0 }] as const),
  );
}

/**
 * Each message's recommended shows, as cards, in the order they were picked, with where each
 * streams among the user's services and any the request named ("something on Netflix").
 */
async function loadPicks(
  db: Db,
  userId: string,
  messageIds: string[],
): Promise<Map<string, PickView[]>> {
  if (messageIds.length === 0) return new Map();
  const rows = await db
    .select({
      messageId: recommendations.chatMessageId,
      picks: recommendations.picks,
      constraints: recommendations.constraints,
    })
    .from(recommendations)
    .where(
      and(eq(recommendations.userId, userId), inArray(recommendations.chatMessageId, messageIds)),
    );
  const ids = [...new Set(rows.flatMap((r) => r.picks.map((p) => p.animeId)))];
  if (ids.length === 0) return new Map();
  const shows = await db
    .select({
      animeId: anime.malId,
      title: anime.title,
      pictureUrl: anime.mainPictureUrl,
      numEpisodes: anime.numEpisodes,
      episodeMinutes: anime.episodeMinutes,
      status: listEntries.status,
      episodesWatched: listEntries.numEpisodesWatched,
      // A list show's links are in the AniList cache; a new show's came with the discovery pool.
      listLinks: anilistMedia.streamingLinks,
      poolLinks: anilistCatalog.streamingLinks,
    })
    .from(anime)
    .leftJoin(
      listEntries,
      and(eq(listEntries.animeId, anime.malId), eq(listEntries.userId, userId)),
    )
    .leftJoin(anilistMedia, eq(anilistMedia.malId, anime.malId))
    .leftJoin(anilistCatalog, eq(anilistCatalog.malId, anime.malId))
    .where(inArray(anime.malId, ids));
  const [settings] = await db
    .select({ services: briefSettings.services })
    .from(briefSettings)
    .where(eq(briefSettings.userId, userId));
  const theirs = settings?.services ?? [];
  const byId = new Map(
    shows.map(({ listLinks, poolLinks, ...s }) => [
      s.animeId,
      {
        ...s,
        episodesWatched: s.episodesWatched ?? 0,
        links: [...(listLinks ?? []), ...(poolLinks ?? [])],
      },
    ]),
  );
  return new Map(
    rows.flatMap((r) =>
      r.messageId
        ? [
            [
              r.messageId,
              r.picks.flatMap((p) => {
                const found = byId.get(p.animeId);
                if (!found) return [];
                const { links, ...show } = found;
                const services = [...theirs, ...askedServices(r.constraints, p.animeId)];
                return [{ ...show, why: p.why, watchOn: watchOn(links, services) }];
              }),
            ] as const,
          ]
        : [],
    ),
  );
}

/** The streaming services the search a pick came from asked for (stored with the picks). */
function askedServices(constraints: Record<string, unknown>, animeId: number): string[] {
  const search = constraints[String(animeId)];
  if (typeof search !== "object" || search === null || !("services" in search)) return [];
  const { services } = search;
  return Array.isArray(services) ? services.filter((s) => typeof s === "string") : [];
}

/** The user's most recent committed changes, newest first. */
export async function loadChanges(db: Db, userId: string, limit = 50): Promise<ChangeView[]> {
  const rows = await db
    .select({
      change: changes,
      show: {
        title: anime.title,
        pictureUrl: anime.mainPictureUrl,
        numEpisodes: anime.numEpisodes,
      },
      source: proposals.source,
    })
    .from(changes)
    .innerJoin(anime, eq(changes.animeId, anime.malId))
    .innerJoin(proposals, eq(changes.proposalId, proposals.id))
    .where(eq(changes.userId, userId))
    .orderBy(desc(changes.committedAt))
    .limit(limit);
  return rows.map((r) => toChangeView(r.change, r.show, r.source));
}

export async function loadChange(db: Db, userId: string, id: string): Promise<ChangeView | null> {
  const [row] = await db
    .select({
      change: changes,
      show: {
        title: anime.title,
        pictureUrl: anime.mainPictureUrl,
        numEpisodes: anime.numEpisodes,
      },
      source: proposals.source,
    })
    .from(changes)
    .innerJoin(anime, eq(changes.animeId, anime.malId))
    .innerJoin(proposals, eq(changes.proposalId, proposals.id))
    .where(and(eq(changes.userId, userId), eq(changes.id, id)));
  return row ? toChangeView(row.change, row.show, row.source) : null;
}

function toChangeView(
  change: typeof changes.$inferSelect,
  show: { title: string; pictureUrl: string | null; numEpisodes: number | null },
  source: ChangeView["source"],
): ChangeView {
  return {
    id: change.id,
    proposalId: change.proposalId,
    animeId: change.animeId,
    title: show.title,
    pictureUrl: show.pictureUrl,
    numEpisodes: show.numEpisodes,
    kind: change.kind,
    before: change.before,
    after: change.after,
    committedAt: change.committedAt.toISOString(),
    undone: change.undoneByChangeId !== null,
    isUndo: source === "undo",
    source,
  };
}

function pickChanged(before: ListChange, change: ListChange): ListChange {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(change) as (keyof ListChange)[]) out[key] = before[key];
  return out;
}
