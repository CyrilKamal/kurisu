/**
 * Checks every eval case file: schema, unique ids, titles that resolve to exactly one snapshot
 * entry, and values in range. Runs in CI.
 *
 *   pnpm eval:validate            summary, errors and warnings
 *   pnpm eval:validate --verbose  also prints each case's expected change after normalization
 */
import { loadCases, type Problem } from "../cases.js";
import { loadCatalog } from "../catalog.js";
import {
  hasPrivateCases,
  loadPrivateAiring,
  loadPrivateSnapshot,
  PRIVATE_DIR,
} from "../private.js";
import { loadImportCases } from "../importCases.js";
import { loadRagCases } from "../ragCases.js";
import { loadRecommendCases } from "../recommendCases.js";
import { loadDetails, loadDiscovery } from "../recommendData.js";
import { loadSeason } from "../season.js";
import { loadStreaming } from "../streaming.js";

const verbose = process.argv.includes("--verbose");
const { cases, errors, warnings } = loadCases();
const recommend = loadRecommendCases(
  loadDetails(),
  loadDiscovery(),
  undefined,
  undefined,
  loadStreaming(),
  loadSeason(),
);
errors.push(...recommend.errors);
warnings.push(...recommend.warnings);
const imported = loadImportCases(loadCatalog());
errors.push(...imported.errors);
const rag = loadRagCases();
errors.push(...rag.errors);
// The review queue's cases, on the PC that has them (eval/private/ is gitignored).
if (hasPrivateCases()) {
  const labeled = loadCases(PRIVATE_DIR, loadPrivateSnapshot, loadPrivateAiring());
  const inPrivate = (p: Problem) => ({ ...p, file: `private/${p.file}` });
  errors.push(...labeled.errors.map(inPrivate));
  warnings.push(...labeled.warnings.map(inPrivate));
  cases.push(...labeled.cases);
}

const where = (p: Problem) =>
  `${p.file}${p.line !== undefined ? `:${String(p.line)}` : ""}${p.caseId ? ` [${p.caseId}]` : ""}`;
for (const problem of errors) console.error(`ERROR   ${where(problem)}: ${problem.message}`);
for (const problem of warnings) console.warn(`warning ${where(problem)}: ${problem.message}`);

if (verbose) {
  for (const { case: c, expectedChanges, expectedAdds } of cases) {
    const writes = [...expectedChanges].map(
      ([id, change]) => `${String(id)} ${JSON.stringify(change)}`,
    );
    const adds = [...expectedAdds].map(
      ([id, change]) => `add ${String(id)} ${JSON.stringify(change)}`,
    );
    const expectation = [
      c.expect.clarify ? "ask" : null,
      writes.length ? writes.join("; ") : null,
      adds.length ? adds.join("; ") : null,
    ]
      .filter(Boolean)
      .join(" + ");
    console.log(`${c.id.padEnd(28)} ${expectation || "no action"}`);
  }
}

if (verbose) {
  for (const { case: c } of recommend.cases) {
    const e = c.expect;
    const labels = [
      e.picks ? null : "no picks",
      e.source === "any" ? null : `from ${e.source}`,
      e.media_types ? e.media_types.join("/") : null,
      e.max_episode_minutes === undefined
        ? null
        : `≤${String(e.max_episode_minutes)} min` +
          (e.grace_minutes === undefined ? "" : ` (+${String(e.grace_minutes)} grace)`),
      e.max_episodes_left === undefined ? null : `≤${String(e.max_episodes_left)} eps left`,
      e.year_from === undefined && e.year_to === undefined
        ? null
        : `aired ${e.year_from === undefined ? "" : String(e.year_from)}-${e.year_to === undefined ? "" : String(e.year_to)}` +
          (e.grace_years === undefined ? "" : ` (+${String(e.grace_years)} grace)`),
      e.clarify ? "asks" : null,
      e.genres_any ? `any of ${e.genres_any.join(", ")}` : null,
      e.genres_none ? `none of ${e.genres_none.join(", ")}` : null,
      e.must_not.length ? `never ${e.must_not.join(", ")}` : null,
    ].filter(Boolean);
    console.log(`${c.id.padEnd(28)} recommend: ${labels.join("; ") || "anything"}`);
  }
}

const byFile = new Map<string, number>();
const byTag = new Map<string, number>();
if (verbose) {
  for (const { case: c, rows } of imported.cases) {
    const summary = rows
      .map(
        (r) => `${String(r.line)}:${r.group}${r.animeId === null ? "" : ` ${String(r.animeId)}`}`,
      )
      .join(", ");
    console.log(`${c.id.padEnd(28)} import: ${summary}`);
  }
}

if (verbose) {
  for (const { case: c, sources } of rag.cases) {
    const e = c.expect;
    const expectation = e.not_on_list
      ? "says it isn't on the list"
      : e.unanswerable
        ? "says the list can't tell"
        : `states ${e.facts.join("; ")}`;
    console.log(`${c.id.padEnd(28)} rag: ${expectation}; sources ${sources.join(", ") || "none"}`);
  }
}

for (const { file, case: c } of [...cases, ...recommend.cases, ...imported.cases, ...rag.cases]) {
  byFile.set(file, (byFile.get(file) ?? 0) + 1);
  for (const tag of c.tags) byTag.set(tag, (byTag.get(tag) ?? 0) + 1);
}
const list = (m: Map<string, number>) =>
  [...m]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, n]) => `${k} ${String(n)}`)
    .join(", ");

console.log(
  `\n${String(cases.length + recommend.cases.length + imported.cases.length + rag.cases.length)} valid cases${byFile.size ? ` (${list(byFile)})` : ""}`,
);
if (byTag.size) console.log(`tags: ${list(byTag)}`);
console.log(`${String(errors.length)} errors, ${String(warnings.length)} warnings`);
process.exitCode = errors.length > 0 ? 1 : 0;
