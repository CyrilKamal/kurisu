/**
 * Freezes AniList's answers to title searches into eval/snapshots/catalog.json, so eval cases
 * about adding shows have fixed answers:
 *
 *   pnpm eval:catalog "frieren" "dandadan"
 *
 * Titles already frozen keep their first answer: cases are labeled against it. Adult titles are
 * left out, as in the app.
 */
import { writeFileSync } from "node:fs";
import { parseArgs } from "node:util";

import { createAniListClient, DEFAULT_ANILIST_API_URL } from "../../../src/anilist/client.js";
import { normalizeName } from "../../../src/list/seasons.js";
import { CATALOG_FILE, loadCatalog, type CatalogFreeze } from "../catalog.js";

const { positionals } = parseArgs({ allowPositionals: true });
if (positionals.length === 0) {
  console.error('Pass the titles to search, e.g. pnpm eval:catalog "frieren" "dandadan"');
  process.exit(1);
}

const freeze: CatalogFreeze = loadCatalog() ?? {
  description:
    "AniList's answers to title searches, frozen so eval cases about adding shows have fixed answers. Show metadata only. A title already here is never re-searched.",
  source: "anilist",
  searches: [],
};
const done = new Set(freeze.searches.map((s) => normalizeName(s.query)));
const anilist = createAniListClient({ apiUrl: DEFAULT_ANILIST_API_URL });

for (const query of positionals) {
  if (done.has(normalizeName(query))) {
    console.log(`"${query}": already frozen, kept as it was.`);
    continue;
  }
  const shows = await anilist.searchAnime([query]);
  freeze.searches.push({ query, frozenAt: new Date().toISOString(), shows });
  done.add(normalizeName(query));
  console.log(`"${query}": ${String(shows.length)} shows`);
  for (const show of shows) {
    console.log(`  ${show.malId === null ? "(no MAL id)" : String(show.malId)}  ${show.title}`);
  }
}

writeFileSync(CATALOG_FILE, `${JSON.stringify(freeze, null, 2)}\n`);
console.log(`Wrote ${CATALOG_FILE}`);
