import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { z } from "zod";

/**
 * Lab files kept on this machine only (gitignored): text that isn't ours to publish in this
 * public repo, and cached vectors.
 */
export const LOCAL_DIR = fileURLToPath(new URL("../local/", import.meta.url));

/**
 * AniList's descriptions of the eval's shows, as plain text without spoilers, frozen once by
 * `pnpm eval:synopses` so Milestone 7's lab experiments (semantic recommendations, RAG over the
 * list) have fixed text to embed. They're publishers' words, so the file stays local; every lab
 * result records its `frozenAt`. A show AniList has no description for has a null synopsis.
 */
export const SYNOPSES_FILE = `${LOCAL_DIR}synopses.json`;

export const synopsesFreezeSchema = z
  .object({
    description: z.string(),
    source: z.literal("anilist"),
    frozenAt: z.iso.datetime(),
    shows: z.array(
      z.object({ malId: z.number().int().positive(), synopsis: z.string().nullable() }).strict(),
    ),
  })
  .strict();
export type SynopsesFreeze = z.infer<typeof synopsesFreezeSchema>;

export function loadSynopses(file: string = SYNOPSES_FILE): SynopsesFreeze | null {
  if (!existsSync(file)) return null;
  return synopsesFreezeSchema.parse(JSON.parse(readFileSync(file, "utf8")));
}
