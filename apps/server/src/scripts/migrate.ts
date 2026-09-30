import { runMigrations } from "../db/migrate.js";
import { loadLocalEnvFile } from "../env.js";

loadLocalEnvFile();

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is not set. Add it to .env.local (see .env.example).");
  process.exit(1);
}

await runMigrations(databaseUrl);
console.log("Migrations applied.");
