import { existsSync, readFileSync } from "node:fs";

import { z } from "zod";

import type { StreamingLink } from "../../src/anilist/client.js";
import { SNAPSHOTS_DIR } from "./snapshot.js";

/**
 * Where the recommendation eval's shows stream, frozen once from AniList by `pnpm eval:streaming`:
 * the my-list snapshot's shows the recommender can pick, and the discovery pool's shows. Public
 * show data only. Shows AniList can't match to their MAL entry are left out, as the app leaves
 * them out.
 */
export const STREAMING_FILE = `${SNAPSHOTS_DIR}streaming.json`;

const linkSchema = z
  .object({ siteId: z.number().int().positive(), site: z.string(), url: z.string() })
  .strict();

export const streamingFreezeSchema = z
  .object({
    description: z.string(),
    source: z.literal("anilist"),
    frozenAt: z.iso.datetime(),
    shows: z.array(
      z
        .object({
          malId: z.number().int().positive(),
          anilistId: z.number().int().positive(),
          /** Enabled official streaming links, one per site. */
          links: z.array(linkSchema),
        })
        .strict(),
    ),
  })
  .strict();
export type StreamingFreeze = z.infer<typeof streamingFreezeSchema>;

export function loadStreaming(file: string = STREAMING_FILE): StreamingFreeze | null {
  if (!existsSync(file)) return null;
  return streamingFreezeSchema.parse(JSON.parse(readFileSync(file, "utf8")));
}

/** Each frozen show's links, by MAL id. */
export function linksByMalId(freeze: StreamingFreeze | null): Map<number, StreamingLink[]> {
  return new Map((freeze?.shows ?? []).map((show) => [show.malId, show.links]));
}
