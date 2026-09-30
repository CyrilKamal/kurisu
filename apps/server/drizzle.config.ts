import { defineConfig } from "drizzle-kit";

// Used only by `drizzle-kit generate` to diff the schema into SQL migrations; migrations are
// applied by src/db/migrate.ts, so no database credentials are needed here.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  strict: true,
});
