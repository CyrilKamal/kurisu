import { asc, eq } from "drizzle-orm";

import type { Db } from "../db/client.js";
import { anime, diaryNotes, dropReasons, listEntries } from "../db/schema.js";
import type { Embedder } from "../llm/modelClient.js";
import { ensureEmbeddings, pruneEmbeddings } from "./embeddings.js";

/**
 * Milestone 7's RAG: the user's list as documents, one per entry, for answering questions about
 * it ("what did I drop for being slow?", "which mecha shows have I finished?"). Each holds what
 * kurisu knows about the show and the user's own words about it: their diary notes (quotes from
 * their Chat messages) and why they dropped it. Stored as the user's `history` vectors.
 */
export interface ListDocument {
  malId: number;
  title: string;
  text: string;
}

const STATUS_NAMES = {
  watching: "Watching",
  completed: "Completed",
  on_hold: "On hold",
  dropped: "Dropped",
  plan_to_watch: "Plan to Watch",
} as const;

const MEDIA_NAMES: Record<string, string> = {
  tv: "TV series",
  tv_special: "TV special",
  movie: "Movie",
  ova: "OVA",
  ona: "ONA",
  special: "Special",
  music: "Music video",
};

export async function listDocuments(db: Db, userId: string): Promise<ListDocument[]> {
  const rows = await db
    .select({
      malId: anime.malId,
      title: anime.title,
      titleEn: anime.titleEn,
      synonyms: anime.synonyms,
      mediaType: anime.mediaType,
      numEpisodes: anime.numEpisodes,
      episodeMinutes: anime.episodeMinutes,
      airedFrom: anime.startDate,
      genres: anime.genres,
      malMean: anime.malMean,
      synopsis: anime.synopsis,
      status: listEntries.status,
      score: listEntries.score,
      watched: listEntries.numEpisodesWatched,
      isRewatching: listEntries.isRewatching,
      startDate: listEntries.startDate,
      finishDate: listEntries.finishDate,
    })
    .from(listEntries)
    .innerJoin(anime, eq(anime.malId, listEntries.animeId))
    .where(eq(listEntries.userId, userId))
    .orderBy(asc(anime.malId));
  const notes = await db
    .select({ animeId: diaryNotes.animeId, text: diaryNotes.text, at: diaryNotes.createdAt })
    .from(diaryNotes)
    .where(eq(diaryNotes.userId, userId))
    .orderBy(asc(diaryNotes.createdAt));
  const drops = await db
    .select({
      animeId: dropReasons.animeId,
      category: dropReasons.category,
      said: dropReasons.said,
    })
    .from(dropReasons)
    .where(eq(dropReasons.userId, userId))
    .orderBy(asc(dropReasons.createdAt));

  return rows.map((row) => {
    const lines: string[] = [];
    const names = [
      ...new Set([row.titleEn ?? "", ...row.synonyms].filter((n) => n && n !== row.title)),
    ];
    lines.push(names.length > 0 ? `${row.title} (also called ${names.join("; ")})` : row.title);

    const facts: string[] = [];
    const kind = MEDIA_NAMES[row.mediaType ?? ""] ?? null;
    if (kind) facts.push(kind);
    if (row.numEpisodes) {
      facts.push(
        `${String(row.numEpisodes)} episode${row.numEpisodes === 1 ? "" : "s"}${row.episodeMinutes ? ` of ${String(row.episodeMinutes)} min` : ""}`,
      );
    }
    if (row.airedFrom) facts.push(`first aired ${row.airedFrom.slice(0, 4)}`);
    if (row.genres.length > 0) facts.push(`genres: ${row.genres.join(", ")}`);
    if (row.malMean !== null) facts.push(`MAL score ${row.malMean.toFixed(2)}`);
    if (facts.length > 0) lines.push(`${facts.join("; ")}.`);

    const mine = [`On my list: ${STATUS_NAMES[row.status]}`];
    if (row.status !== "plan_to_watch") {
      mine.push(
        row.numEpisodes
          ? `watched ${String(row.watched)} of ${String(row.numEpisodes)} episodes`
          : `watched ${String(row.watched)} episodes`,
      );
    }
    if (row.isRewatching) mine.push("rewatching it");
    if (row.score > 0) mine.push(`I scored it ${String(row.score)}/10`);
    if (row.startDate) mine.push(`started ${row.startDate}`);
    if (row.finishDate) mine.push(`finished ${row.finishDate}`);
    lines.push(`${mine.join("; ")}.`);

    for (const drop of drops.filter((d) => d.animeId === row.malId)) {
      lines.push(`Why I dropped it: ${drop.category.replace(/_/g, " ")} ("${drop.said}").`);
    }
    for (const note of notes.filter((n) => n.animeId === row.malId)) {
      lines.push(`My note (${note.at.toISOString().slice(0, 10)}): "${note.text}"`);
    }
    if (row.synopsis?.trim()) lines.push(`Synopsis: ${row.synopsis.trim()}`);
    return { malId: row.malId, title: row.title, text: lines.join("\n") };
  });
}

/**
 * Makes sure the user's list documents have current vectors: only changed ones are embedded, and
 * shows no longer on the list lose theirs.
 */
export async function ensureListDocuments(
  deps: { db: Db; embedder: Embedder },
  userId: string,
): Promise<{ documents: ListDocument[]; embedded: number; removed: number }> {
  const documents = await listDocuments(deps.db, userId);
  const items = documents.map((doc) => ({ ref: String(doc.malId), text: doc.text }));
  const { embedded } = await ensureEmbeddings(deps, "history", items, { userId });
  const removed = await pruneEmbeddings(
    deps,
    "history",
    items.map((item) => item.ref),
    { userId },
  );
  return { documents, embedded, removed };
}
