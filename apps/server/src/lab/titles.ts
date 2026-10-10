import { inArray } from "drizzle-orm";

import type { Db } from "../db/client.js";
import { anime } from "../db/schema.js";
import type { Embedder } from "../llm/modelClient.js";
import { ensureEmbeddings } from "./embeddings.js";

/** A show's names as one text, the way its `title` vector is made: "Sousou no Frieren · Frieren". */
export function titleText(show: {
  title: string;
  titleEn: string | null;
  synonyms: string[];
}): string {
  const names = [show.title, show.titleEn ?? "", ...show.synonyms]
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
  return [...new Set(names)].join(" · ");
}

/**
 * Makes sure these shows have current `title` vectors (shared by everyone, so stored once). Only
 * new or renamed shows are embedded.
 */
export async function ensureTitleEmbeddings(
  deps: { db: Db; embedder: Embedder },
  animeIds: number[],
): Promise<{ embedded: number }> {
  if (animeIds.length === 0) return { embedded: 0 };
  const shows = await deps.db
    .select({
      malId: anime.malId,
      title: anime.title,
      titleEn: anime.titleEn,
      synonyms: anime.synonyms,
    })
    .from(anime)
    .where(inArray(anime.malId, [...new Set(animeIds)]));
  const { embedded } = await ensureEmbeddings(
    deps,
    "title",
    shows.map((show) => ({ ref: String(show.malId), text: titleText(show) })),
  );
  return { embedded };
}
