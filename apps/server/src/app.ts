import Fastify, { type FastifyInstance } from "fastify";

import type { Config } from "./config.js";

/** Builds the HTTP app without listening, so tests can drive it with `app.inject`. */
export function buildApp(config: Config): FastifyInstance {
  const app = Fastify({ logger: { level: config.logLevel } });

  app.get("/health", () => ({ status: "ok" }));

  return app;
}
