/**
 * Freezes AniList's descriptions of the eval's shows into eval/local/synopses.json (gitignored:
 * publishers' text), for Milestone 7's lab. Run once per machine:
 *
 *   pnpm eval:synopses
 *
 * The shows are the list snapshot's, the discovery pool's and this season's (my-list.json,
 * discovery.json, season.json). Descriptions are cleaned as the app cleans them (plainSynopsis:
 * no markup, no spoilers). It refuses to overwrite an existing file: lab results are measured
 * against it. Pass --force only if nothing depends on it yet.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";

import { createAniListClient, DEFAULT_ANILIST_API_URL } from "../../../src/anilist/client.js";
import { plainSynopsis } from "../../../src/anilist/synopsis.js";
import { loadDiscovery } from "../recommendData.js";
import { loadSeason } from "../season.js";
import { loadSnapshot } from "../snapshot.js";
import { LOCAL_DIR, SYNOPSES_FILE, type SynopsesFreeze } from "../synopses.js";

const { values } = parseArgs({ options: { force: { type: "boolean", default: false } } });
if (existsSync(SYNOPSES_FILE) && !values.force) {
  console.error(
    `${SYNOPSES_FILE} already exists, and lab results may depend on it. Not overwriting.`,
  );
  process.exit(1);
}

const ids = [
  ...new Set([
    ...loadSnapshot("my-list").entries.map((entry) => entry.id),
    ...(loadDiscovery()?.shows.map((show) => show.malId) ?? []),
    ...(loadSeason()?.shows.map((show) => show.malId) ?? []),
  ]),
].sort((a, b) => a - b);

console.log(`Asking AniList for ${String(ids.length)} descriptions (about 3 s per 50)…`);
const anilist = createAniListClient({ apiUrl: DEFAULT_ANILIST_API_URL });
const found = await anilist.descriptions(ids);

const shows = ids.map((malId) => {
  const raw = found.get(malId) ?? null;
  const synopsis = raw === null ? "" : plainSynopsis(raw);
  return { malId, synopsis: synopsis || null };
});
const freeze: SynopsesFreeze = {
  description:
    "AniList's descriptions of the eval's shows (the list snapshot, the discovery pool and this season), as plain text without spoilers, for Milestone 7's lab. Publishers' text: kept on this machine, never committed.",
  source: "anilist",
  frozenAt: new Date().toISOString(),
  shows,
};
mkdirSync(LOCAL_DIR, { recursive: true });
writeFileSync(SYNOPSES_FILE, `${JSON.stringify(freeze, null, 2)}\n`);
const missing = shows.filter((show) => show.synopsis === null).length;
console.log(
  `Wrote ${SYNOPSES_FILE}: ${String(shows.length)} shows, ${String(missing)} without a description.`,
);
