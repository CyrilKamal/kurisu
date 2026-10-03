/**
 * Looks up shows in an eval snapshot while you write cases.
 *
 *   pnpm eval:lookup frieren                     every entry with "frieren" in one of its names
 *   pnpm eval:lookup --status watching           everything you're watching
 *   pnpm eval:lookup --airing not_yet_aired      everything MAL says hasn't aired
 *   pnpm eval:lookup tokyo --snapshot examples   another snapshot (default my-list)
 */
import { parseArgs } from "node:util";

import { MAL_LIST_STATUSES } from "../../../src/mal/client.js";
import { describeEntry, lookUp } from "../lookup.js";
import { loadSnapshot } from "../snapshot.js";

const LIMIT = 30;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    snapshot: { type: "string", default: "my-list" },
    status: { type: "string" },
    airing: { type: "string" },
  },
});

const query = positionals.join(" ");
const status = values.status?.replace(/[\s-]+/g, "_");
if (status && !(MAL_LIST_STATUSES as readonly string[]).includes(status)) {
  console.error(`--status must be one of: ${MAL_LIST_STATUSES.join(", ")}`);
  process.exit(1);
}
if (!query && !status && !values.airing) {
  console.error("Pass words to search for, --status, or --airing. Example: pnpm eval:lookup jjk");
  process.exit(1);
}

const hits = lookUp(loadSnapshot(values.snapshot), query, {
  ...(status && { status }),
  ...(values.airing && { airing: values.airing }),
});
if (hits.length === 0) {
  console.log(
    `Nothing in the "${values.snapshot}" snapshot matches. Fine for a not-on-your-list case, but try the show's other names first.`,
  );
} else {
  console.log(hits.slice(0, LIMIT).map(describeEntry).join("\n\n"));
  const more = hits.length - LIMIT;
  console.log(
    `\n${String(hits.length)} match${hits.length === 1 ? "" : "es"}${more > 0 ? ` (first ${String(LIMIT)} shown; narrow the search)` : ""}`,
  );
}
