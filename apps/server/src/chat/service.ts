import { and, desc, eq, inArray } from "drizzle-orm";

import { runAgent, type AgentDeps, type RunResult } from "../agent/runAgent.js";
import type { Db } from "../db/client.js";
import { anime, changes, chatMessages, conversations, proposals } from "../db/schema.js";
import type { ModelRef } from "../llm/modelConfig.js";
import type { ListChange } from "../writes/normalize.js";

export interface ChatDeps extends AgentDeps {
  roles: { agent: ModelRef; escalation: ModelRef | null };
}

/** Earlier messages the model sees for context. */
const HISTORY_MESSAGES = 6;

export interface ChangeView {
  id: string;
  animeId: number;
  title: string;
  before: ListChange;
  after: ListChange;
  committedAt: string;
  undone: boolean;
  isUndo: boolean;
}

export interface PendingView {
  id: string;
  animeId: number;
  title: string;
  before: ListChange;
  change: ListChange;
  reason: string | null;
}

export interface ChatMessageView {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  changes: ChangeView[];
  pending: PendingView[];
}

/**
 * Handles one user message: runs the agent on the configured model and, if that run ended
 * without writing anything because it had to ask, hold a change, or failed, retries once on the
 * escalation model. The escalated answer replaces the first only if it succeeds.
 */
export async function handleChatMessage(
  deps: ChatDeps,
  userId: string,
  text: string,
): Promise<{ userMessageId: string; assistantMessageId: string; run: RunResult }> {
  const { db } = deps;
  const conversationId = await currentConversation(db, userId);
  const history = (
    await db
      .select({ role: chatMessages.role, content: chatMessages.content })
      .from(chatMessages)
      .where(eq(chatMessages.conversationId, conversationId))
      .orderBy(desc(chatMessages.createdAt))
      .limit(HISTORY_MESSAGES)
  ).reverse();

  const [userMessage] = await db
    .insert(chatMessages)
    .values({ conversationId, role: "user", content: text })
    .returning({ id: chatMessages.id });
  if (!userMessage) throw new Error("chat message insert returned no row");

  const input = { userId, conversationId, history, message: text };
  let run = await runAgent(deps, { ...input, model: deps.roles.agent });

  const escalation = deps.roles.escalation;
  const worthEscalating =
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

  const [assistantMessage] = await db
    .insert(chatMessages)
    .values({
      conversationId,
      role: "assistant",
      content: run.outcome === "error" ? errorReply(run.error) : run.reply || "Done.",
      runId: run.runId,
    })
    .returning({ id: chatMessages.id });
  if (!assistantMessage) throw new Error("chat message insert returned no row");

  return { userMessageId: userMessage.id, assistantMessageId: assistantMessage.id, run };
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

async function currentConversation(db: Db, userId: string): Promise<string> {
  const [latest] = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(eq(conversations.userId, userId))
    .orderBy(desc(conversations.createdAt))
    .limit(1);
  if (latest) return latest.id;
  const [created] = await db
    .insert(conversations)
    .values({ userId })
    .returning({ id: conversations.id });
  if (!created) throw new Error("conversation insert returned no row");
  return created.id;
}

/** The latest conversation's messages, oldest first, each with the changes it made. */
export async function loadThread(
  db: Db,
  userId: string,
  limit = 50,
  onlyIds?: string[],
): Promise<ChatMessageView[]> {
  const [conversation] = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(eq(conversations.userId, userId))
    .orderBy(desc(conversations.createdAt))
    .limit(1);
  if (!conversation) return [];

  const rows = (
    await db
      .select()
      .from(chatMessages)
      .where(
        and(
          eq(chatMessages.conversationId, conversation.id),
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
          .select({ proposal: proposals, title: anime.title, change: changes })
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

  return rows.map((row) => {
    const mine = cards.filter((c) => c.proposal.runId === row.runId);
    return {
      id: row.id,
      role: row.role,
      content: row.content,
      createdAt: row.createdAt.toISOString(),
      changes: mine.flatMap((c) => (c.change ? [toChangeView(c.change, c.title, false)] : [])),
      pending: mine
        .filter((c) => c.proposal.status === "pending" && c.proposal.requiresConfirmation)
        .map((c) => ({
          id: c.proposal.id,
          animeId: c.proposal.animeId,
          title: c.title,
          before: pickChanged(c.proposal.before, c.proposal.change),
          change: c.proposal.change,
          reason: c.proposal.confirmationReason,
        })),
    };
  });
}

/** The user's most recent committed changes, newest first. */
export async function loadChanges(db: Db, userId: string, limit = 50): Promise<ChangeView[]> {
  const rows = await db
    .select({ change: changes, title: anime.title, source: proposals.source })
    .from(changes)
    .innerJoin(anime, eq(changes.animeId, anime.malId))
    .innerJoin(proposals, eq(changes.proposalId, proposals.id))
    .where(eq(changes.userId, userId))
    .orderBy(desc(changes.committedAt))
    .limit(limit);
  return rows.map((r) => toChangeView(r.change, r.title, r.source === "undo"));
}

export async function loadChange(db: Db, userId: string, id: string): Promise<ChangeView | null> {
  const [row] = await db
    .select({ change: changes, title: anime.title, source: proposals.source })
    .from(changes)
    .innerJoin(anime, eq(changes.animeId, anime.malId))
    .innerJoin(proposals, eq(changes.proposalId, proposals.id))
    .where(and(eq(changes.userId, userId), eq(changes.id, id)));
  return row ? toChangeView(row.change, row.title, row.source === "undo") : null;
}

function toChangeView(
  change: typeof changes.$inferSelect,
  title: string,
  isUndo: boolean,
): ChangeView {
  return {
    id: change.id,
    animeId: change.animeId,
    title,
    before: change.before,
    after: change.after,
    committedAt: change.committedAt.toISOString(),
    undone: change.undoneByChangeId !== null,
    isUndo,
  };
}

function pickChanged(before: ListChange, change: ListChange): ListChange {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(change) as (keyof ListChange)[]) out[key] = before[key];
  return out;
}
