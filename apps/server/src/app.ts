import fastifyCookie from "@fastify/cookie";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";

import { CURRENT_PROMPT, RECOMMEND_PROMPT } from "./agent/prompts/index.js";
import { IMPORT_V1 } from "./agent/prompts/import.v1.js";
import { registerImportRoutes } from "./import/routes.js";
import { resumeImports } from "./import/service.js";
import {
  airingCandidateIds,
  recommendableIds,
  refreshAiring,
  STREAMING_MAX_AGE_MS,
} from "./anilist/cache.js";
import { completedIds, refreshSequels } from "./anilist/sequels.js";
import { refreshDiscovery } from "./recommend/discovery.js";
import { refreshTaste } from "./taste/profile.js";
import { createAniListClient } from "./anilist/client.js";
import { registerAuthRoutes } from "./auth/routes.js";
import { createTokenStore } from "./auth/tokenStore.js";
import { registerBriefRoutes } from "./brief/routes.js";
import { createBriefScheduler } from "./brief/scheduler.js";
import type { Prompt } from "./agent/runAgent.js";
import { registerChatRoutes } from "./chat/routes.js";
import type { Config } from "./config.js";
import { createTokenCipher } from "./crypto/tokenCipher.js";
import { createDb } from "./db/client.js";
import { registerListRoutes } from "./list/routes.js";
import { createModelClient, type ModelClient } from "./llm/modelClient.js";
import { loadModelsFile, resolveRoles, type ModelRef } from "./llm/modelConfig.js";
import type { RetryOptions } from "./mal/client.js";
import { registerPushRoutes } from "./push/routes.js";
import { createPushSender } from "./push/send.js";
import { createListSync } from "./sync/listSync.js";
import { registerTasteRoutes } from "./taste/routes.js";
import { createAnimeRefresher } from "./sync/animeDetails.js";
import { createMalListRemover, createMalListWriter } from "./writes/commit.js";

export interface BuildAppOptions {
  /** Where log lines go; defaults to stdout. Tests pass a stream to inspect what gets logged. */
  logStream?: NodeJS.WritableStream;
  /** Backoff for MAL API retries. Tests shorten it. */
  malRetry?: RetryOptions;
  /** Tests inject a scripted model client and the models it answers as. */
  models?: ModelClient;
  roles?: { agent: ModelRef; escalation: ModelRef | null; brief?: ModelRef; recommend?: ModelRef };
  /** AniList request spacing and retries. Tests shorten them. */
  anilist?: { minIntervalMs?: number; retry?: RetryOptions };
  /** Extra push-service origins to accept; tests point subscriptions at a local fake. */
  pushOrigins?: string[];
  /** Chat's prompt, when tests try one that isn't the app's yet. */
  prompt?: Prompt;
  /** Pause between an import's MAL writes; tests use 0. */
  importWriteIntervalMs?: number;
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
  // After each list sync, refresh AniList airing data for the shows Chat may ask about ("the
  // newest episode"), in the background so the sync doesn't wait on AniList.
  const syncAniList = createAniListClient({
    apiUrl: config.anilist.apiUrl,
    retry: options.anilist?.retry ?? { retries: 1, baseDelayMs: 500, maxDelayMs: 2_000 },
    ...(options.anilist?.minIntervalMs !== undefined && {
      minIntervalMs: options.anilist.minIntervalMs,
    }),
  });
  // One refresh per user at a time; a sync while one runs doesn't queue another.
  const airingRefreshes = new Map<string, Promise<void>>();
  app.addHook("onClose", async () => {
    await Promise.allSettled(airingRefreshes.values());
  });
  const refreshAiringAfterSync = (userId: string) => {
    if (airingRefreshes.has(userId)) return;
    const task: Promise<void> = (async () => {
      // Rating patterns come straight from the fresh mirror; airing data needs AniList.
      await refreshTaste(db, userId);
      await refreshAiring(
        { db, anilist: syncAniList, log: app.log },
        await airingCandidateIds(db, userId),
      );
    })()
      .catch((err: unknown) => {
        app.log.warn(
          { err: { name: (err as Error).name } },
          "could not refresh taste or airing data after sync",
        );
      })
      // Where the shows the recommender can pick stream (the same AniList rows, kept a week).
      .then(async () => {
        await refreshAiring(
          { db, anilist: syncAniList, log: app.log },
          await recommendableIds(db, userId),
          { maxAgeMs: STREAMING_MAX_AGE_MS },
        );
      })
      .catch((err: unknown) => {
        app.log.warn({ err: { name: (err as Error).name } }, "could not refresh where to watch");
      })
      // What follows each show they completed, so the brief can say when a sequel starts airing
      // (kept a week; the brief refreshes it too).
      .then(async () => {
        await refreshSequels({ db, anilist: syncAniList }, await completedIds(db, userId));
      })
      .catch((err: unknown) => {
        app.log.warn({ err: { name: (err as Error).name } }, "could not refresh sequels");
      })
      // Shows new to the user, for recommendations: at most daily, and never in the way of the
      // airing data above. It records its own failures.
      .then(() => refreshDiscovery({ db, anilist: syncAniList, log: app.log }, userId))
      .then(() => undefined)
      .catch((err: unknown) => {
        app.log.warn({ err: { name: (err as Error).name } }, "could not refresh discovery");
      })
      .finally(() => airingRefreshes.delete(userId));
    airingRefreshes.set(userId, task);
  };

  const listSync = createListSync({
    db,
    tokenStore,
    apiBaseUrl: config.mal.apiBaseUrl,
    log: app.log,
    afterSync: refreshAiringAfterSync,
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
  const malWrites = {
    tokenStore,
    apiBaseUrl: config.mal.apiBaseUrl,
    ...(options.malRetry ? { retry: options.malRetry } : {}),
  };
  const writeListStatus = createMalListWriter(malWrites);
  // Chat's searches of all anime get their own AniList client, so they never queue behind a
  // background airing refresh.
  const chatAniList = createAniListClient({ apiUrl: config.anilist.apiUrl, ...options.anilist });

  const push = createPushSender({
    db,
    vapid: config.push,
    log: app.log,
    ...(options.pushOrigins ? { extraOrigins: options.pushOrigins } : {}),
  });
  if (!config.push) app.log.info("VAPID keys not set; push notifications are off");

  const briefDeps = {
    db,
    anilist: createAniListClient({ apiUrl: config.anilist.apiUrl, ...options.anilist }),
    push,
    models,
    model: options.roles?.brief ?? configuredRoles.brief,
    log: app.log,
  };
  if (config.brief.scheduler && config.push) {
    const scheduler = createBriefScheduler({ ...briefDeps, databaseUrl: config.databaseUrl });
    app.addHook("onReady", () => scheduler.start());
    app.addHook("onClose", () => scheduler.stop());
  }

  void app.register(fastifyCookie);
  app.decorateRequest("user", null);

  app.get("/health", () => ({ status: "ok" }));
  registerAuthRoutes(app, { config, db, cipher, tokenStore, listSync });
  // Every write to MAL, from Chat, the List screen or an import, goes through these.
  const writeDeps = {
    db,
    writeListStatus,
    removeListStatus: createMalListRemover(malWrites),
    refreshAnime: createAnimeRefresher({ db, ...malWrites }),
  };
  registerListRoutes(app, { config, db, listSync, writes: writeDeps });
  registerTasteRoutes(app, { config, db });
  registerPushRoutes(app, {
    config,
    db,
    push,
    ...(options.pushOrigins ? { extraOrigins: options.pushOrigins } : {}),
  });
  registerBriefRoutes(app, { ...briefDeps, config });
  registerChatRoutes(app, {
    config,
    db,
    models,
    writeListStatus: writeDeps.writeListStatus,
    removeListStatus: writeDeps.removeListStatus,
    refreshAnime: writeDeps.refreshAnime,
    catalog: (queries) => chatAniList.searchAnime(queries),
    prompt: options.prompt ?? CURRENT_PROMPT,
    recommendPrompt: RECOMMEND_PROMPT,
    roles: {
      agent: options.roles?.agent ?? configuredRoles.agent,
      escalation:
        options.roles?.escalation === undefined
          ? configuredRoles.escalation
          : options.roles.escalation,
      recommend: options.roles?.recommend ?? configuredRoles.recommend,
    },
  });

  const importDeps = {
    db,
    models,
    model: options.roles?.agent ?? configuredRoles.agent,
    prompt: IMPORT_V1,
    catalog: (queries: string[]) => chatAniList.searchAnime(queries),
    writes: writeDeps,
    // MAL's limits are undocumented: about one write a second.
    writeIntervalMs: options.importWriteIntervalMs ?? 1000,
    log: (message: string, err?: unknown) => {
      app.log.error({ err }, message);
    },
  };
  registerImportRoutes(app, { ...importDeps, config });
  app.addHook("onReady", async () => {
    try {
      await resumeImports(importDeps);
    } catch (err) {
      app.log.warn({ err }, "could not resume imports");
    }
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
