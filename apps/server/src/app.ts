import fastifyCookie from "@fastify/cookie";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";

import { registerAuthRoutes } from "./auth/routes.js";
import { createTokenStore } from "./auth/tokenStore.js";
import type { Config } from "./config.js";
import { createTokenCipher } from "./crypto/tokenCipher.js";
import { createDb } from "./db/client.js";

export interface BuildAppOptions {
  /** Where log lines go; defaults to stdout. Tests pass a stream to inspect what gets logged. */
  logStream?: NodeJS.WritableStream;
}

/** Builds the HTTP app without listening, so tests can drive it with `app.inject`. */
export function buildApp(config: Config, options: BuildAppOptions = {}): FastifyInstance {
  const app = Fastify({
    logger: {
      level: config.logLevel,
      ...(options.logStream ? { stream: options.logStream } : {}),
      // Secrets must never reach the logs: auth headers, cookies, and OAuth query strings.
      redact: ["req.headers.authorization", "req.headers.cookie", 'res.headers["set-cookie"]'],
      serializers: { req: serializeRequest },
    },
  });

  const { db, close } = createDb(config.databaseUrl);
  app.addHook("onClose", close);

  const cipher = createTokenCipher(config.tokenEncryptionKey);
  const tokenStore = createTokenStore({ db, cipher, oauth: config.mal });

  void app.register(fastifyCookie);
  app.decorateRequest("user", null);

  app.get("/health", () => ({ status: "ok" }));
  registerAuthRoutes(app, { config, db, cipher, tokenStore });

  return app;
}

/** Logs the path without its query string, which can carry OAuth codes and state. */
function serializeRequest(request: FastifyRequest) {
  return {
    method: request.method,
    url: request.url.split("?", 1)[0],
    remoteAddress: request.ip,
  };
}
