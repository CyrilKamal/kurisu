import { fileURLToPath } from "node:url";

import { migrate } from "drizzle-orm/node-postgres/migrator";

import { createDb } from "./client.js";

export const migrationsFolder = fileURLToPath(new URL("../../drizzle", import.meta.url));

/** Applies all pending SQL migrations from apps/server/drizzle. Safe to run repeatedly. */
export async function runMigrations(databaseUrl: string): Promise<void> {
  const { db, close } = createDb(databaseUrl);
  try {
    await migrate(db, { migrationsFolder });
  } finally {
    await close();
  }
}
