/**
 * Freezes AniList's airing data for the eval snapshots' shows into eval/snapshots/airing.json,
 * so "the newest episode" cases have a fixed answer. Run once:
 *
 *   pnpm eval:airing
 *
 * It refuses to overwrite an existing file: cases are labeled against it. Pass --force only if
 * no case depends on it yet.
 */
import { existsSync, readdirSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";

import { latestAiredEpisode } from "../../../src/anilist/cache.js";
import { createAniListClient, DEFAULT_ANILIST_API_URL } from "../../../src/anilist/client.js";
import { AIRING_FILE, type AiringFreeze } from "../airing.js";
import { loadSnapshot, SNAPSHOTS_DIR } from "../snapshot.js";

const { values } = parseArgs({ options: { force: { type: "boolean", default: false } } });
if (existsSync(AIRING_FILE) && !values.force) {
  console.error(`${AIRING_FILE} already exists, and eval cases may depend on it. Not overwriting.`);
  process.exit(1);
}

/** Files in the snapshots folder that hold frozen data rather than a list snapshot. */
const FROZEN_FILES = new Set([
  "airing.json",
  "catalog.json",
  "details.json",
  "discovery.json",
  "season.json",
  "streaming.json",
]);

// Shows "the newest episode" can be about: anything watching, airing, or about to air.
const malIds = new Set<number>();
for (const file of readdirSync(SNAPSHOTS_DIR)) {
  if (!file.endsWith(".json") || FROZEN_FILES.has(file)) continue;
  const snapshot = loadSnapshot(file.replace(/\.json$/, ""));
  if (snapshot.source === "synthetic") continue;
  for (const entry of snapshot.entries) {
    if (
      entry.status === "watching" ||
      entry.airingStatus === "currently_airing" ||
      entry.airingStatus === "not_yet_aired"
    ) {
      malIds.add(entry.id);
    }
  }
}

const anilist = createAniListClient({ apiUrl: DEFAULT_ANILIST_API_URL });
const now = new Date();
const { media } = await anilist.mediaByMalIds([...malIds]);
const freeze: AiringFreeze = {
  description:
    "AniList airing data for the eval snapshots' watching and airing shows, frozen so 'the newest episode' cases have a fixed answer. Never re-exported.",
  source: "anilist",
  frozenAt: now.toISOString(),
  shows: media
    .map((m) => ({
      malId: m.malId,
      anilistId: m.anilistId,
      status: m.status,
      latestAired: latestAiredEpisode(
        {
          anilistId: m.anilistId,
          status: m.status,
          episodes: m.episodes,
          nextEpisode: m.nextEpisode?.episode ?? null,
          nextAiringAt: m.nextEpisode?.airingAt ?? null,
          fetchedAt: now,
        },
        now,
      ),
    }))
    .sort((a, b) => a.malId - b.malId),
};
writeFileSync(AIRING_FILE, `${JSON.stringify(freeze, null, 2)}\n`);
const airing = freeze.shows.filter((s) => s.status !== "FINISHED" && s.latestAired !== null);
console.log(
  `Froze ${String(freeze.shows.length)} of ${String(malIds.size)} shows (${String(airing.length)} airing with a known latest episode; ${String(malIds.size - freeze.shows.length)} not on AniList).`,
);
