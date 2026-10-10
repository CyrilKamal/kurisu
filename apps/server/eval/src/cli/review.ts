/**
 * The review queue: replies on the hosted app that may have gone wrong (a failed run, a chat
 * write undone within a day, or a reply someone reported), for the owner to label as eval cases.
 *
 *   pnpm review --env-file ../kurisu-prod/.env.prod         new items, newest first
 *   pnpm review --env-file ... --all                          also exported and dismissed ones
 *   pnpm review --env-file ... --export <id>                  a draft case and its list, into eval/private/
 *   pnpm review --env-file ... --dismiss <id>
 *
 * <id> is the start of an item's id, as the listing prints it. Without --env-file it reads the dev
 * database from .env.local. A .env.prod has no DATABASE_URL; the hosted database is built from its
 * POSTGRES_* settings, on 127.0.0.1 at PROD_DB_PORT (default 5433).
 */
import { parseArgs } from "node:util";

import { and, asc, desc, eq, inArray, like, sql } from "drizzle-orm";

import { stepArgs, stepResult } from "../../../src/chat/trace.js";
import { createDb } from "../../../src/db/client.js";
import { agentRuns, agentRunSteps, reviewItems, users } from "../../../src/db/schema.js";
import { loadLocalEnvFile } from "../../../src/env.js";
import { PRIVATE_DRAFTS_DIR, PRIVATE_SNAPSHOTS_DIR } from "../private.js";
import { writeReviewDraft } from "../reviewExport.js";

const { values } = parseArgs({
  options: {
    "env-file": { type: "string" },
    all: { type: "boolean", default: false },
    export: { type: "string" },
    dismiss: { type: "string" },
  },
});

if (values["env-file"]) process.loadEnvFile(values["env-file"]);
else loadLocalEnvFile();
const env = process.env;
const databaseUrl =
  env.DATABASE_URL ??
  (env.POSTGRES_USER && env.POSTGRES_PASSWORD && env.POSTGRES_DB
    ? `postgres://${env.POSTGRES_USER}:${env.POSTGRES_PASSWORD}@127.0.0.1:${env.PROD_DB_PORT ?? "5433"}/${env.POSTGRES_DB}`
    : undefined);
if (!databaseUrl) {
  console.error("No database: set DATABASE_URL, or POSTGRES_USER/PASSWORD/DB (see --env-file).");
  process.exit(1);
}

const { db, close } = createDb(databaseUrl);
try {
  if (values.export) await exportItem(values.export);
  else if (values.dismiss) await setStatus(values.dismiss, "dismissed");
  else await list(values.all);
} finally {
  await close();
}

async function find(prefix: string) {
  if (!/^[0-9a-f-]{4,36}$/.test(prefix)) throw new Error(`"${prefix}" isn't an item id.`);
  const rows = await db
    .select()
    .from(reviewItems)
    .where(like(sql`${reviewItems.id}::text`, `${prefix}%`));
  if (rows.length !== 1) {
    throw new Error(rows.length === 0 ? `No item ${prefix}.` : `${prefix} matches several items.`);
  }
  const [row] = rows;
  if (!row) throw new Error("unreachable");
  return row;
}

async function setStatus(prefix: string, status: "exported" | "dismissed") {
  const item = await find(prefix);
  await db.update(reviewItems).set({ status }).where(eq(reviewItems.id, item.id));
  console.log(`${item.id.slice(0, 8)} is ${status}.`);
}

async function list(all: boolean) {
  const items = await db
    .select({
      id: reviewItems.id,
      runId: reviewItems.runId,
      kind: reviewItems.kind,
      note: reviewItems.note,
      message: reviewItems.message,
      reply: reviewItems.reply,
      status: reviewItems.status,
      createdAt: reviewItems.createdAt,
      user: users.malUsername,
      model: agentRuns.model,
      prompt: agentRuns.promptVersion,
      outcome: agentRuns.outcome,
    })
    .from(reviewItems)
    .innerJoin(users, eq(users.id, reviewItems.userId))
    .innerJoin(agentRuns, eq(agentRuns.id, reviewItems.runId))
    .where(all ? undefined : eq(reviewItems.status, "new"))
    .orderBy(desc(reviewItems.createdAt));
  if (items.length === 0) {
    console.log(all ? "The review queue is empty." : "Nothing new in the review queue.");
    return;
  }
  const steps = await db
    .select({
      runId: agentRunSteps.runId,
      tool: agentRunSteps.toolName,
      args: agentRunSteps.args,
      result: agentRunSteps.result,
      error: agentRunSteps.error,
    })
    .from(agentRunSteps)
    .where(
      and(
        inArray(
          agentRunSteps.runId,
          items.map((i) => i.runId),
        ),
        eq(agentRunSteps.kind, "tool_call"),
      ),
    )
    .orderBy(asc(agentRunSteps.seq));

  for (const item of items) {
    console.log(
      `\n${item.id.slice(0, 8)}  ${item.createdAt.toISOString().slice(0, 16)}  ${item.user}  ${item.kind}${item.status === "new" ? "" : ` (${item.status})`}`,
    );
    if (item.note) console.log(`  why:     ${item.note}`);
    console.log(`  said:    ${item.message}`);
    console.log(`  replied: ${item.reply.replace(/\s+/g, " ").slice(0, 300)}`);
    console.log(`  run:     ${item.model} ${item.prompt} → ${item.outcome ?? "?"}`);
    for (const step of steps.filter((s) => s.runId === item.runId)) {
      const result = stepResult(step.result, step.error);
      console.log(`    ${step.tool ?? "?"} ${stepArgs(step.args)} → ${result.text}`);
    }
  }
  console.log(`\n${String(items.length)} item(s). Export one with --export <id>.`);
}

async function exportItem(prefix: string) {
  const item = await find(prefix);
  const { name, snapshot } = writeReviewDraft(item, {
    drafts: PRIVATE_DRAFTS_DIR,
    snapshots: PRIVATE_SNAPSHOTS_DIR,
  });
  await db.update(reviewItems).set({ status: "exported" }).where(eq(reviewItems.id, item.id));
  console.log(
    `Wrote eval/private/drafts/${name}.yaml and its snapshot (${String(snapshot.entries.length)} entries).`,
  );
}
