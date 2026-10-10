import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import type { TestProject } from "vitest/node";

import { runMigrations } from "../../src/db/migrate.js";
import { POSTGRES_IMAGE } from "../../src/db/postgresImage.js";

declare module "vitest" {
  export interface ProvidedContext {
    databaseUrl: string;
  }
}

let container: StartedPostgreSqlContainer | undefined;

export default async function setup(project: TestProject) {
  container = await new PostgreSqlContainer(POSTGRES_IMAGE).start();
  const databaseUrl = container.getConnectionUri();
  await runMigrations(databaseUrl);
  project.provide("databaseUrl", databaseUrl);

  return async () => {
    await container?.stop();
  };
}
