import type { PgDatabase } from "drizzle-orm/pg-core";
import { drizzle, type NodePgDatabase, type NodePgQueryResultHKT } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "./schema.js";

export type Db = NodePgDatabase<typeof schema>;

/** Either the database or an open transaction, for helpers that can run inside one. */
export type Executor = PgDatabase<NodePgQueryResultHKT, typeof schema>;

export interface DbHandle {
  db: Db;
  close: () => Promise<void>;
}

export function createDb(databaseUrl: string): DbHandle {
  const pool = new Pool({ connectionString: databaseUrl, max: 10 });
  const db = drizzle({ client: pool, schema });
  return { db, close: () => pool.end() };
}
