import { existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { loadAiring, type AiringFreeze } from "./airing.js";
import { loadSnapshot, type Snapshot } from "./snapshot.js";

/**
 * Eval cases from the hosted app's review queue (pnpm review): real people's messages and lists,
 * so they stay on this PC. The folder is gitignored; CI never sees it.
 *   eval/private/*.yaml                labeled cases, run with `pnpm eval --dir private`
 *   eval/private/drafts/*.yaml         exported, waiting for a label
 *   eval/private/snapshots/<name>.json         the list as it was before the run
 *   eval/private/snapshots/<name>.airing.json  its shows' newest episodes then
 */
export const PRIVATE_DIR = fileURLToPath(new URL("../private/", import.meta.url));
export const PRIVATE_DRAFTS_DIR = `${PRIVATE_DIR}drafts/`;
export const PRIVATE_SNAPSHOTS_DIR = `${PRIVATE_DIR}snapshots/`;

export function hasPrivateCases(): boolean {
  return existsSync(PRIVATE_DIR);
}

export function loadPrivateSnapshot(name: string): Snapshot {
  return loadSnapshot(name, PRIVATE_SNAPSHOTS_DIR);
}

/**
 * The shared airing freeze with every private snapshot's airing laid over it, so each case's
 * shows have their newest episode as of its capture. Two captures of one show keep the later.
 */
export function loadPrivateAiring(): AiringFreeze | null {
  const shared = loadAiring();
  if (!existsSync(PRIVATE_SNAPSHOTS_DIR)) return shared;
  const files = readdirSync(PRIVATE_SNAPSHOTS_DIR)
    .filter((f) => f.endsWith(".airing.json"))
    .sort();
  const shows = new Map((shared?.shows ?? []).map((show) => [show.malId, show]));
  let frozenAt = shared?.frozenAt ?? new Date(0).toISOString();
  for (const file of files) {
    const freeze = loadAiring(`${PRIVATE_SNAPSHOTS_DIR}${file}`);
    if (!freeze) continue;
    for (const show of freeze.shows) shows.set(show.malId, show);
    if (freeze.frozenAt > frozenAt) frozenAt = freeze.frozenAt;
  }
  return {
    description: "The shared airing freeze, with each review capture's shows laid over it.",
    source: "anilist",
    frozenAt,
    shows: [...shows.values()],
  };
}
