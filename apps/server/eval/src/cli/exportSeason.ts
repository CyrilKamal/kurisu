/**
 * Freezes what's airing into eval/snapshots/season.json, so "what's good this season" cases have
 * a fixed answer. Run once:
 *
 *   pnpm eval:season
 *
 * It asks AniList for this season's series and last season's still airing, most popular first,
 * and keeps the ones the app would (on MAL, started airing, not adult), with their details and
 * streaming links. It refuses to overwrite an existing file: cases are labeled against it. Pass
 * --force only if no case depends on it yet.
 */
import { existsSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";

import { createAniListClient, DEFAULT_ANILIST_API_URL } from "../../../src/anilist/client.js";
import { catalogRowFrom, usable } from "../../../src/recommend/discovery.js";
import { seasonKey, seasonOf } from "../../../src/recommend/season.js";
import { SEASON_FILE, seasonFreezeSchema } from "../season.js";

const { values } = parseArgs({ options: { force: { type: "boolean", default: false } } });
if (existsSync(SEASON_FILE) && !values.force) {
  console.error(`${SEASON_FILE} already exists, and eval cases may depend on it. Not overwriting.`);
  process.exit(1);
}

const anilist = createAniListClient({ apiUrl: DEFAULT_ANILIST_API_URL });
const now = new Date();
const current = seasonOf(now);
const [thisSeason = [], stillAiring = []] = await anilist.seasonLineup([
  { season: current.season, year: current.year },
  { ...current.previous, airing: true },
]);
const order = [...new Set([...thisSeason, ...stillAiring])];
const details = new Map((await anilist.showDetails(order)).map((s) => [s.anilistId, s]));
const kept = order.flatMap((id) => {
  const show = details.get(id);
  return show && usable(show) ? [show] : [];
});
const unique = [...new Map(kept.map((s) => [s.malId, s])).values()];

const freeze = seasonFreezeSchema.parse({
  description:
    "What was airing (this season's series and last season's still airing, most popular first), frozen for the recommendation eval's 'this season' cases. Public show data only. Never re-exported.",
  source: "anilist",
  season: seasonKey(current),
  frozenAt: now.toISOString(),
  shows: unique.map((show, i) => {
    const row = catalogRowFrom(show);
    return {
      malId: row.malId,
      anilistId: row.anilistId,
      title: row.title,
      titleEn: row.titleEn ?? null,
      titleJa: row.titleJa ?? null,
      synonyms: row.synonyms ?? [],
      mediaType: row.mediaType ?? null,
      airingStatus: row.airingStatus ?? null,
      numEpisodes: row.numEpisodes ?? null,
      episodeMinutes: row.episodeMinutes ?? null,
      genres: row.genres ?? [],
      score: row.score ?? null,
      popularity: row.popularity ?? null,
      coverUrl: row.coverUrl ?? null,
      startDate: row.startDate ?? null,
      prequelMalIds: row.prequelMalIds ?? [],
      rank: i + 1,
      links: row.streamingLinks ?? [],
    };
  }),
});
writeFileSync(SEASON_FILE, `${JSON.stringify(freeze, null, 2)}\n`);
console.log(
  `Froze ${String(freeze.shows.length)} shows airing in ${freeze.season} (of ${String(order.length)} AniList listed).`,
);
