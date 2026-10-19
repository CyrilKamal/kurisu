/**
 * Puts an account on a plan by hand (Milestone 8), for testing and support: a "manual"
 * subscription, with or without an end. Free takes away a manual one; a paid one comes from the
 * payment provider and is changed there.
 *
 *   pnpm plan:grant <mal username> premium|pro [--until YYYY-MM-DD] [--env-file <.env.prod>]
 *   pnpm plan:grant <mal username> free
 *
 * Without --env-file it uses the dev database (.env.local).
 */
import { parseArgs } from "node:util";

import { and, eq, sql } from "drizzle-orm";

import { createDb } from "../db/client.js";
import { subscriptions, users } from "../db/schema.js";
import { loadLocalEnvFile } from "../env.js";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { until: { type: "string" }, "env-file": { type: "string" } },
});
const [username, plan] = positionals;
if (!username || (plan !== "free" && plan !== "premium" && plan !== "pro")) {
  console.error("Usage: pnpm plan:grant <mal username> free|premium|pro [--until YYYY-MM-DD]");
  process.exit(1);
}
const until = values.until ? new Date(`${values.until}T00:00:00Z`) : null;
if (until && Number.isNaN(until.getTime())) {
  console.error("--until takes a date: YYYY-MM-DD.");
  process.exit(1);
}

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
  const [user] = await db
    .select({ id: users.id, name: users.malUsername })
    .from(users)
    .where(eq(sql`lower(${users.malUsername})`, username.toLowerCase()));
  if (!user) throw new Error(`No account for MAL user ${username}.`);

  if (plan === "free") {
    const removed = await db
      .delete(subscriptions)
      .where(and(eq(subscriptions.userId, user.id), eq(subscriptions.provider, "manual")))
      .returning({ id: subscriptions.id });
    console.log(
      removed.length > 0
        ? `${user.name} is back on their own plan (Free, or a trial if one is running).`
        : `${user.name} had no manual plan; nothing changed.`,
    );
  } else {
    const [existing] = await db
      .select({ provider: subscriptions.provider })
      .from(subscriptions)
      .where(eq(subscriptions.userId, user.id));
    if (existing && existing.provider !== "manual") {
      throw new Error(`${user.name} pays through ${existing.provider}; change it there.`);
    }
    await db
      .insert(subscriptions)
      .values({
        userId: user.id,
        plan,
        status: "active",
        provider: "manual",
        currentPeriodEnd: until,
      })
      .onConflictDoUpdate({
        target: subscriptions.userId,
        set: { plan, status: "active", currentPeriodEnd: until, updatedAt: new Date() },
      });
    console.log(
      `${user.name} is on ${plan}${until ? ` until ${until.toISOString().slice(0, 10)}` : ""}.`,
    );
  }
} finally {
  await close();
}
