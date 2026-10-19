import type { DataExport } from "@kurisu/shared";
import { asc, eq, inArray, or } from "drizzle-orm";

import type { Db } from "../db/client.js";
import {
  agentRuns,
  anime,
  briefSettings,
  briefs,
  calendarFeeds,
  changes,
  chatMessages,
  conversations,
  diaryNotes,
  dropReasons,
  friendships,
  imports,
  invites,
  listEntries,
  listEvents,
  pushSubscriptions,
  recommendations,
  tasteGenres,
  users,
  yearlyGoals,
} from "../db/schema.js";

/**
 * Everything kurisu holds about a user (GET /me/export), as the rows it stores them in, for the
 * user to keep or take elsewhere. Secrets stay out: MAL tokens, sessions, the friend and calendar
 * links' codes, invite codes, and push keys. Show titles come along, so the rows read on their own.
 */
export async function exportUserData(
  db: Db,
  userId: string,
  plan: Record<string, unknown>,
  now = new Date(),
): Promise<DataExport> {
  const [account] = await db.select().from(users).where(eq(users.id, userId));
  if (!account) throw new Error("no such user");

  const chats = await db
    .select()
    .from(conversations)
    .where(eq(conversations.userId, userId))
    .orderBy(asc(conversations.createdAt));
  const messages = chats.length
    ? await db
        .select({
          conversationId: chatMessages.conversationId,
          role: chatMessages.role,
          content: chatMessages.content,
          createdAt: chatMessages.createdAt,
        })
        .from(chatMessages)
        .where(
          inArray(
            chatMessages.conversationId,
            chats.map((chat) => chat.id),
          ),
        )
        .orderBy(asc(chatMessages.createdAt))
    : [];

  const pairs = await db
    .select()
    .from(friendships)
    .where(or(eq(friendships.userA, userId), eq(friendships.userB, userId)));
  const friendIds = pairs.map((pair) => (pair.userA === userId ? pair.userB : pair.userA));
  const names = friendIds.length
    ? await db
        .select({ id: users.id, malUsername: users.malUsername })
        .from(users)
        .where(inArray(users.id, friendIds))
    : [];
  const nameOf = new Map(names.map((row) => [row.id, row.malUsername]));

  return {
    kurisuExport: 1,
    exportedAt: now.toISOString(),
    account: {
      malUsername: account.malUsername,
      malUserId: account.malUserId,
      createdAt: account.createdAt,
      welcomedAt: account.welcomedAt,
      shareActivity: account.shareActivity,
      trialEndsAt: account.trialEndsAt,
      ageConfirmedAt: account.ageConfirmedAt,
      termsAcceptedAt: account.termsAcceptedAt,
      termsVersion: account.termsVersion,
    },
    plan,
    list: await db
      .select({
        animeId: listEntries.animeId,
        title: anime.title,
        status: listEntries.status,
        score: listEntries.score,
        episodesWatched: listEntries.numEpisodesWatched,
        isRewatching: listEntries.isRewatching,
        startDate: listEntries.startDate,
        finishDate: listEntries.finishDate,
        malUpdatedAt: listEntries.malUpdatedAt,
      })
      .from(listEntries)
      .innerJoin(anime, eq(anime.malId, listEntries.animeId))
      .where(eq(listEntries.userId, userId))
      .orderBy(asc(anime.title)),
    changes: await db
      .select({
        id: changes.id,
        animeId: changes.animeId,
        title: anime.title,
        kind: changes.kind,
        before: changes.before,
        after: changes.after,
        committedAt: changes.committedAt,
        undoneByChangeId: changes.undoneByChangeId,
      })
      .from(changes)
      .innerJoin(anime, eq(anime.malId, changes.animeId))
      .where(eq(changes.userId, userId))
      .orderBy(asc(changes.committedAt)),
    listEvents: await db
      .select({
        animeId: listEvents.animeId,
        title: anime.title,
        kind: listEvents.kind,
        before: listEvents.before,
        after: listEvents.after,
        at: listEvents.at,
      })
      .from(listEvents)
      .innerJoin(anime, eq(anime.malId, listEvents.animeId))
      .where(eq(listEvents.userId, userId))
      .orderBy(asc(listEvents.at)),
    chats: chats.map((chat) => ({
      title: chat.title,
      createdAt: chat.createdAt,
      messages: messages
        .filter((message) => message.conversationId === chat.id)
        .map((message) => ({
          role: message.role,
          content: message.content,
          createdAt: message.createdAt,
        })),
    })),
    diaryNotes: await db
      .select({
        animeId: diaryNotes.animeId,
        title: anime.title,
        text: diaryNotes.text,
        shared: diaryNotes.shared,
        createdAt: diaryNotes.createdAt,
      })
      .from(diaryNotes)
      .innerJoin(anime, eq(anime.malId, diaryNotes.animeId))
      .where(eq(diaryNotes.userId, userId))
      .orderBy(asc(diaryNotes.createdAt)),
    dropReasons: await db
      .select({
        animeId: dropReasons.animeId,
        title: anime.title,
        category: dropReasons.category,
        said: dropReasons.said,
        createdAt: dropReasons.createdAt,
      })
      .from(dropReasons)
      .innerJoin(anime, eq(anime.malId, dropReasons.animeId))
      .where(eq(dropReasons.userId, userId)),
    tasteGenres: await db.select().from(tasteGenres).where(eq(tasteGenres.userId, userId)),
    yearlyGoals: await db.select().from(yearlyGoals).where(eq(yearlyGoals.userId, userId)),
    briefSettings: await db.select().from(briefSettings).where(eq(briefSettings.userId, userId)),
    briefs: await db
      .select({
        kind: briefs.kind,
        localDate: briefs.localDate,
        status: briefs.status,
        items: briefs.items,
        alerts: briefs.alerts,
        recap: briefs.recap,
        summary: briefs.summary,
        createdAt: briefs.createdAt,
      })
      .from(briefs)
      .where(eq(briefs.userId, userId))
      .orderBy(asc(briefs.createdAt)),
    recommendations: await db
      .select({
        picks: recommendations.picks,
        constraints: recommendations.constraints,
        createdAt: recommendations.createdAt,
      })
      .from(recommendations)
      .where(eq(recommendations.userId, userId))
      .orderBy(asc(recommendations.createdAt)),
    imports: await db
      .select({
        text: imports.text,
        status: imports.status,
        createdAt: imports.createdAt,
      })
      .from(imports)
      .where(eq(imports.userId, userId))
      .orderBy(asc(imports.createdAt)),
    friends: pairs.map((pair) => ({
      malUsername: nameOf.get(pair.userA === userId ? pair.userB : pair.userA) ?? null,
      via: pair.via,
      since: pair.createdAt,
    })),
    invites: await db
      .select({
        note: invites.note,
        createdAt: invites.createdAt,
        expiresAt: invites.expiresAt,
        usedAt: invites.usedAt,
      })
      .from(invites)
      .where(eq(invites.createdBy, userId)),
    calendarFeed: await db
      .select({ createdAt: calendarFeeds.createdAt, lastFetchedAt: calendarFeeds.lastFetchedAt })
      .from(calendarFeeds)
      .where(eq(calendarFeeds.userId, userId)),
    pushSubscriptions: (
      await db
        .select({ endpoint: pushSubscriptions.endpoint, createdAt: pushSubscriptions.createdAt })
        .from(pushSubscriptions)
        .where(eq(pushSubscriptions.userId, userId))
    ).map((row) => ({ service: new URL(row.endpoint).host, createdAt: row.createdAt })),
    agentRuns: await db
      .select({
        startedAt: agentRuns.startedAt,
        promptVersion: agentRuns.promptVersion,
        model: agentRuns.model,
        latencyMs: agentRuns.latencyMs,
        inputTokens: agentRuns.inputTokens,
        outputTokens: agentRuns.outputTokens,
        outcome: agentRuns.outcome,
      })
      .from(agentRuns)
      .where(eq(agentRuns.userId, userId))
      .orderBy(asc(agentRuns.startedAt)),
  };
}
