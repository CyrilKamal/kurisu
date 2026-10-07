/**
 * Checks every eval case file: schema, unique ids, titles that resolve to exactly one snapshot
 * entry, and values in range. Runs in CI.
 *
 *   pnpm eval:validate            summary, errors and warnings
 *   pnpm eval:validate --verbose  also prints each case's expected change after normalization
 */
import { loadCases, type Problem } from "../cases.js";
import { loadRecommendCases } from "../recommendCases.js";
import { loadDetails, loadDiscovery } from "../recommendData.js";

const verbose = process.argv.includes("--verbose");
const { cases, errors, warnings } = loadCases();
const recommend = loadRecommendCases(loadDetails(), loadDiscovery());
errors.push(...recommend.errors);
warnings.push(...recommend.warnings);

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
      e.max_episode_minutes === undefined ? null : `≤${String(e.max_episode_minutes)} min`,
      e.genres_any ? `any of ${e.genres_any.join(", ")}` : null,
      e.genres_none ? `none of ${e.genres_none.join(", ")}` : null,
      e.must_not.length ? `never ${e.must_not.join(", ")}` : null,
    ].filter(Boolean);
    console.log(`${c.id.padEnd(28)} recommend: ${labels.join("; ") || "anything"}`);
  }
}

const byFile = new Map<string, number>();
const byTag = new Map<string, number>();
for (const { file, case: c } of [...cases, ...recommend.cases]) {
  byFile.set(file, (byFile.get(file) ?? 0) + 1);
  for (const tag of c.tags) byTag.set(tag, (byTag.get(tag) ?? 0) + 1);
}
const list = (m: Map<string, number>) =>
  [...m]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, n]) => `${k} ${String(n)}`)
    .join(", ");

console.log(
  `\n${String(cases.length + recommend.cases.length)} valid cases${byFile.size ? ` (${list(byFile)})` : ""}`,
);
if (byTag.size) console.log(`tags: ${list(byTag)}`);
console.log(`${String(errors.length)} errors, ${String(warnings.length)} warnings`);
process.exitCode = errors.length > 0 ? 1 : 0;
