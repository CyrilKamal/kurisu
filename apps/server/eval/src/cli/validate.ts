/**
 * Checks every eval case file: schema, unique ids, titles that resolve to exactly one snapshot
 * entry, and values in range. Runs in CI.
 *
 *   pnpm eval:validate            summary, errors and warnings
 *   pnpm eval:validate --verbose  also prints each case's expected change after normalization
 */
import { loadCases } from "../cases.js";

const verbose = process.argv.includes("--verbose");
const { cases, errors, warnings } = loadCases();

for (const problem of errors) {
  console.error(
    `ERROR   ${problem.file}${problem.caseId ? ` [${problem.caseId}]` : ""}: ${problem.message}`,
  );
}
for (const problem of warnings) {
  console.warn(
    `warning ${problem.file}${problem.caseId ? ` [${problem.caseId}]` : ""}: ${problem.message}`,
  );
}

if (verbose) {
  for (const { case: c, expectedChanges } of cases) {
    const writes = [...expectedChanges].map(
      ([id, change]) => `${String(id)} ${JSON.stringify(change)}`,
    );
    const expectation = [c.expect.clarify ? "ask" : null, writes.length ? writes.join("; ") : null]
      .filter(Boolean)
      .join(" + ");
    console.log(`${c.id.padEnd(28)} ${expectation || "no action"}`);
  }
}

const byFile = new Map<string, number>();
const byTag = new Map<string, number>();
for (const { file, case: c } of cases) {
  byFile.set(file, (byFile.get(file) ?? 0) + 1);
  for (const tag of c.tags) byTag.set(tag, (byTag.get(tag) ?? 0) + 1);
}
const list = (m: Map<string, number>) =>
  [...m]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, n]) => `${k} ${String(n)}`)
    .join(", ");

console.log(`\n${String(cases.length)} valid cases${byFile.size ? ` (${list(byFile)})` : ""}`);
if (byTag.size) console.log(`tags: ${list(byTag)}`);
console.log(`${String(errors.length)} errors, ${String(warnings.length)} warnings`);
process.exitCode = errors.length > 0 ? 1 : 0;
