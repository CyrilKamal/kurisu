/**
 * Freezes where the recommendation eval's shows stream into eval/snapshots/streaming.json, so
 * cases about streaming services ("something on Netflix") have a fixed answer. Run once:
 *
 *   pnpm eval:streaming
 *
 * It asks AniList about the my-list snapshot's shows the recommender can pick (Plan to Watch,
 * Watching, On hold, rewatching), by MAL id, as the app's weekly refresh does, and about the
 * frozen discovery pool's shows, by AniList id, as the discovery build does. It refuses to
 * overwrite an existing file: cases are labeled against it. Pass --force only if no case
 * depends on it yet.
 */
import { existsSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";

import { createAniListClient, DEFAULT_ANILIST_API_URL } from "../../../src/anilist/client.js";
import { loadDetails, loadDiscovery } from "../recommendData.js";
import { loadSnapshot } from "../snapshot.js";
import { STREAMING_FILE, streamingFreezeSchema } from "../streaming.js";

const { values } = parseArgs({ options: { force: { type: "boolean", default: false } } });
if (existsSync(STREAMING_FILE) && !values.force) {
  console.error(
    `${STREAMING_FILE} already exists, and eval cases may depend on it. Not overwriting.`,
  );
  process.exit(1);
}

const details = loadDetails();
const pool = loadDiscovery();
if (!details || !pool) {
  console.error("The frozen show details and pool are missing: run pnpm eval:recommend-data.");
  process.exit(1);
}

const snapshot = loadSnapshot(details.snapshot);
const pickable = snapshot.entries.filter(
  (e) =>
    e.status === "plan_to_watch" ||
    e.status === "watching" ||
    e.status === "on_hold" ||
    e.isRewatching,
);
// MAL's start date and episode count, to line up shows AniList splits into parts (as the app does).
const startDates = new Map(details.shows.map((s) => [s.malId, s.startDate ?? null]));
const facts = new Map(
  pickable.map((e) => [
    e.id,
    { startDate: startDates.get(e.id) ?? null, numEpisodes: e.numEpisodes },
  ]),
);

const anilist = createAniListClient({ apiUrl: DEFAULT_ANILIST_API_URL });
const lookup = await anilist.mediaByMalIds(
  pickable.map((e) => e.id),
  facts,
);
const poolMalIds = new Map(pool.shows.map((s) => [s.anilistId, s.malId]));
const poolDetails = await anilist.showDetails([...poolMalIds.keys()]);

const shows = new Map<
  number,
  { malId: number; anilistId: number; links: (typeof lookup.media)[number]["streamingLinks"] }
>();
for (const m of lookup.media) {
  shows.set(m.malId, { malId: m.malId, anilistId: m.anilistId, links: m.streamingLinks });
}
for (const d of poolDetails) {
  const malId = poolMalIds.get(d.anilistId);
  if (malId === undefined || shows.has(malId)) continue;
  shows.set(malId, { malId, anilistId: d.anilistId, links: d.streamingLinks });
}

const freeze = streamingFreezeSchema.parse({
  description:
    "Where the recommendation eval's shows stream (AniList's enabled official links): the my-list snapshot's Plan to Watch, Watching, On hold and rewatching shows, and the discovery pool's shows. Public show data only. Never re-exported.",
  source: "anilist",
  frozenAt: new Date().toISOString(),
  shows: [...shows.values()].sort((a, b) => a.malId - b.malId),
});
writeFileSync(STREAMING_FILE, `${JSON.stringify(freeze, null, 2)}\n`);

const unmatched = pickable.length - lookup.media.length;
const withLinks = freeze.shows.filter((s) => s.links.length > 0).length;
console.log(
  `Froze ${String(freeze.shows.length)} shows (${String(withLinks)} with a streaming link): ${String(lookup.media.length)} of ${String(pickable.length)} pickable list shows (${String(unmatched)} AniList can't match), and ${String(freeze.shows.length - lookup.media.length)} pool shows.`,
);
