import type { BriefCardView, RunView } from "@kurisu/shared";
import { and, asc, eq, inArray, or } from "drizzle-orm";

import type { Db } from "../db/client.js";
import { agentRuns, agentRunSteps, anime, briefs } from "../db/schema.js";
import { stepArgs, stepResult } from "./trace.js";

/**
 * What ran behind each reply (RunMeta and its trace), by the reply's run id
 * (chat_messages.run_id): that run, the one it escalated from, and the recommender it handed the
 * message to. Times, tokens and tool calls add up all of them, in the order they ran.
 */
export async function loadRunViews(
  db: Db,
  userId: string,
  runIds: string[],
): Promise<Map<string, RunView>> {
  if (runIds.length === 0) return new Map();
  // Only this user's runs, though the ids already come from their own chat.
  const runs = await db
    .select()
    .from(agentRuns)
    .where(
      and(
        eq(agentRuns.userId, userId),
        or(inArray(agentRuns.id, runIds), inArray(agentRuns.handedOffFromRunId, runIds)),
      ),
    );
  const byId = new Map(runs.map((r) => [r.id, r]));
  const firstIds = runIds.flatMap((id) => {
    const from = byId.get(id)?.escalatedFromRunId;
    return from ? [from] : [];
  });
  if (firstIds.length > 0) {
    const first = await db
      .select()
      .from(agentRuns)
      .where(and(eq(agentRuns.userId, userId), inArray(agentRuns.id, firstIds)));
    for (const r of first) {
      byId.set(r.id, r);
    }
  }

  const steps = await db
    .select({
      runId: agentRunSteps.runId,
      toolName: agentRunSteps.toolName,
      args: agentRunSteps.args,
      result: agentRunSteps.result,
      latencyMs: agentRunSteps.latencyMs,
      error: agentRunSteps.error,
    })
    .from(agentRunSteps)
    .where(and(inArray(agentRunSteps.runId, [...byId.keys()]), eq(agentRunSteps.kind, "tool_call")))
    .orderBy(asc(agentRunSteps.seq));
  const stepsOf = (runId: string) =>
    steps
      .filter((s) => s.runId === runId)
      .map((s) => {
        const outcome = stepResult(s.result, s.error);
        return {
          tool: s.toolName ?? "tool",
          args: stepArgs(s.args),
          result: outcome.text,
          ok: outcome.ok,
          ms: s.latencyMs,
        };
      });

  const views = new Map<string, RunView>();
  for (const id of runIds) {
    const main = byId.get(id);
    if (!main) continue;
    const first = main.escalatedFromRunId ? byId.get(main.escalatedFromRunId) : undefined;
    const handoff = runs.find((r) => r.handedOffFromRunId === id);
    const chain = [first, main, handoff].filter((r) => r !== undefined);
    // `error` also holds why a run stopped ("handoff"); only a failed run's is an error.
    const failed = [handoff, main].find((r) => r?.outcome === "error");
    views.set(id, {
      model: main.model,
      promptVersion: main.promptVersion,
      escalatedFrom: first?.model ?? null,
      handoff: handoff ? { model: handoff.model, promptVersion: handoff.promptVersion } : null,
      latencyMs: chain.reduce((sum, r) => sum + (r.latencyMs ?? 0), 0),
      inputTokens: chain.reduce((sum, r) => sum + r.inputTokens, 0),
      outputTokens: chain.reduce((sum, r) => sum + r.outputTokens, 0),
      error: failed ? (failed.error ?? "failed") : null,
      steps: chain.flatMap((r) => stepsOf(r.id)),
    });
  }
  return views;
}

/** The brief behind each of these messages (a brief's own message), by message id. */
export async function loadBriefCards(
  db: Db,
  messageIds: string[],
): Promise<Map<string, BriefCardView>> {
  if (messageIds.length === 0) return new Map();
  const rows = await db
    .select({
      messageId: briefs.chatMessageId,
      localDate: briefs.localDate,
      summary: briefs.summary,
      items: briefs.items,
      alerts: briefs.alerts,
      recap: briefs.recap,
    })
    .from(briefs)
    .where(inArray(briefs.chatMessageId, messageIds));
  const showIds = [...new Set(rows.flatMap((r) => (r.items ?? []).map((i) => i.malId)))];
  const shows =
    showIds.length === 0
      ? []
      : await db
          .select({
            malId: anime.malId,
            pictureUrl: anime.mainPictureUrl,
            numEpisodes: anime.numEpisodes,
          })
          .from(anime)
          .where(inArray(anime.malId, showIds));
  const showOf = new Map(shows.map((s) => [s.malId, s]));

  const cards = new Map<string, BriefCardView>();
  for (const row of rows) {
    if (!row.messageId) continue;
    cards.set(row.messageId, {
      localDate: row.localDate,
      summary: row.summary,
      items: (row.items ?? []).map((item) => ({
        animeId: item.malId,
        title: item.title,
        pictureUrl: showOf.get(item.malId)?.pictureUrl ?? null,
        episodes: item.episodes,
        premiere: item.premiere,
        finale: item.finale,
        episodesWatched: item.episodesWatched,
        numEpisodes: showOf.get(item.malId)?.numEpisodes ?? null,
        services: item.services,
      })),
      alerts: row.alerts.map((alert) => ({
        animeId: alert.malId,
        kind: alert.kind,
        after: alert.after,
        services: alert.services,
      })),
      recap: row.recap ?? null,
    });
  }
  return cards;
}
