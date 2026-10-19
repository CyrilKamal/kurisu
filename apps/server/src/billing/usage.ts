import { and, eq, gte, like, sql } from "drizzle-orm";

import type { Db } from "../db/client.js";
import { agentRuns, chatMessages, conversations, imports } from "../db/schema.js";

export interface Usage {
  /** Messages sent in Chat this month, not counting the ones that asked what to watch. */
  chat: number;
  /** Recommendation runs this month: each "what should I watch" message is one. */
  recommendations: number;
  imports: number;
  /** The month's start, and when the allowances come back (the next month's start), UTC. */
  periodStart: Date;
  resetsAt: Date;
}

export function monthBounds(now: Date): { start: Date; next: Date } {
  return {
    start: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
    next: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)),
  };
}

/** What a user has used of their plan's monthly allowances. */
export async function usageOf(db: Db, userId: string, now = new Date()): Promise<Usage> {
  const { start, next } = monthBounds(now);
  const count = sql<number>`count(*)::int`;
  const [[messages], [recommendations], [imported]] = await Promise.all([
    db
      .select({ n: count })
      .from(chatMessages)
      .innerJoin(conversations, eq(chatMessages.conversationId, conversations.id))
      .where(
        and(
          eq(conversations.userId, userId),
          eq(chatMessages.role, "user"),
          gte(chatMessages.createdAt, start),
        ),
      ),
    db
      .select({ n: count })
      .from(agentRuns)
      .where(
        and(
          eq(agentRuns.userId, userId),
          like(agentRuns.promptVersion, "recommend@%"),
          gte(agentRuns.startedAt, start),
        ),
      ),
    db
      .select({ n: count })
      .from(imports)
      .where(and(eq(imports.userId, userId), gte(imports.createdAt, start))),
  ]);
  const recommended = recommendations?.n ?? 0;
  return {
    // A message the recommender answered counts as a recommendation, not as a chat update too.
    chat: Math.max(0, (messages?.n ?? 0) - recommended),
    recommendations: recommended,
    imports: imported?.n ?? 0,
    periodStart: start,
    resetsAt: next,
  };
}
