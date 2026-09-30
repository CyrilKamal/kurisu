import fastifyCookie from "@fastify/cookie";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";

import { CURRENT_PROMPT } from "./agent/prompts/index.js";
import { registerAuthRoutes } from "./auth/routes.js";
import { createTokenStore } from "./auth/tokenStore.js";
import { registerChatRoutes } from "./chat/routes.js";
import type { Config } from "./config.js";
import { createTokenCipher } from "./crypto/tokenCipher.js";
import { createDb } from "./db/client.js";
import { registerListRoutes } from "./list/routes.js";
import { createModelClient, type ModelClient } from "./llm/modelClient.js";
import { loadModelsFile, resolveRoles, type ModelRef } from "./llm/modelConfig.js";
import type { RetryOptions } from "./mal/client.js";
import { createListSync } from "./sync/listSync.js";
import { createMalListWriter } from "./writes/commit.js";

export interface BuildAppOptions {
  /** Where log lines go; defaults to stdout. Tests pass a stream to inspect what gets logged. */
  logStream?: NodeJS.WritableStream;
  /** Backoff for MAL API retries. Tests shorten it. */
  malRetry?: RetryOptions;
  /** Tests inject a scripted model client and the models it answers as. */
  models?: ModelClient;
  roles?: { agent: ModelRef; escalation: ModelRef | null };
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
  const listSync = createListSync({
    db,
    tokenStore,
    apiBaseUrl: config.mal.apiBaseUrl,
    log: app.log,
    ...(options.malRetry ? { retry: options.malRetry } : {}),
  });
  app.addHook("onReady", async () => {
    try {
      await listSync.recoverInterruptedRuns();
    } catch (err) {
      app.log.warn({ err }, "could not mark interrupted sync runs");
    }
  });

  const modelsFile = loadModelsFile();
  const configuredRoles = resolveRoles(modelsFile, config.llm.overrides);
  const models =
    options.models ??
    createModelClient({
      geminiApiKey: config.llm.geminiApiKey,
      ollamaBaseUrl: config.llm.ollamaBaseUrl,
      ollama: modelsFile.ollama,
    });
  const writeListStatus = createMalListWriter({
    tokenStore,
    apiBaseUrl: config.mal.apiBaseUrl,
    ...(options.malRetry ? { retry: options.malRetry } : {}),
  });

  void app.register(fastifyCookie);
  app.decorateRequest("user", null);

  app.get("/health", () => ({ status: "ok" }));
  registerAuthRoutes(app, { config, db, cipher, tokenStore, listSync });
  registerListRoutes(app, { config, db, listSync });
  registerChatRoutes(app, {
    config,
    db,
    models,
    writeListStatus,
    prompt: CURRENT_PROMPT,
    roles: options.roles ?? {
      agent: configuredRoles.agent,
      escalation: configuredRoles.escalation,
    },
  });

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
