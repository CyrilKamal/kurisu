import { STATUS_CODES } from "node:http";

import fastifyCookie from "@fastify/cookie";
import { eq, sql } from "drizzle-orm";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";

import { CURRENT_PROMPT, DIARY_PROMPT, RECOMMEND_PROMPT } from "./agent/prompts/index.js";
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
import { refreshSeason } from "./recommend/season.js";
import { refreshTaste } from "./taste/profile.js";
import {
  createAniListClient,
  createAniListPacer,
  DEFAULT_MIN_INTERVAL_MS,
} from "./anilist/client.js";
import { registerAuthRoutes } from "./auth/routes.js";
import { createTokenStore } from "./auth/tokenStore.js";
import { registerBriefRoutes } from "./brief/routes.js";
import { createBriefScheduler } from "./brief/scheduler.js";
import type { Prompt } from "./agent/runAgent.js";
import { registerChatRoutes } from "./chat/routes.js";
import type { Config } from "./config.js";
import { createTokenCipher } from "./crypto/tokenCipher.js";
import { createDb } from "./db/client.js";
import { listEntries } from "./db/schema.js";
import { registerListRoutes } from "./list/routes.js";
import { createEmbedder, createModelClient, type ModelClient } from "./llm/modelClient.js";
import {
  loadModelsFile,
  resolveEmbedding,
  resolveRoles,
  type ModelRef,
} from "./llm/modelConfig.js";
import { ensureTitleEmbeddings } from "./lab/titles.js";
import type { RetryOptions } from "./mal/client.js";
import { registerPushRoutes } from "./push/routes.js";
import { createPushSender } from "./push/send.js";
import { createListSync } from "./sync/listSync.js";
import { saveReactionsFor } from "./diary/reader.js";
import { registerDiaryRoutes } from "./diary/routes.js";
import { registerInviteRoutes } from "./invites/routes.js";
import { checkBudget } from "./budget/budget.js";
import { registerFriendRoutes } from "./friends/routes.js";
import { captureReview } from "./review/capture.js";
import { registerStatsRoutes } from "./stats/routes.js";
import { createSynopsisLoader } from "./anilist/synopsis.js";
import { registerShowRoutes } from "./shows/routes.js";
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
  /** Whether Chat reads messages for diary reactions (on unless turned off; tests turn it off). */
  diary?: boolean;
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

  // In production a failure's details stay in the logs; the browser only learns that it failed.
  if (config.nodeEnv === "production") {
    app.setErrorHandler((error: { statusCode?: number; message: string }, request, reply) => {
      const statusCode =
        error.statusCode !== undefined && error.statusCode >= 400 ? error.statusCode : 500;
      if (statusCode >= 500) {
        request.log.error({ err: error }, "request failed");
        return reply
          .code(statusCode)
          .send({ statusCode, error: STATUS_CODES[statusCode], message: "Something went wrong" });
      }
      return reply
        .code(statusCode)
        .send({ statusCode, error: STATUS_CODES[statusCode], message: error.message });
    });
  }

  const cipher = createTokenCipher(config.tokenEncryptionKey);
  const tokenStore = createTokenStore({ db, cipher, oauth: config.mal });
  // After each list sync, refresh AniList airing data for the shows Chat may ask about ("the
  // newest episode"), in the background so the sync doesn't wait on AniList.
  // Every AniList client shares one pacer, so with many users' background refreshes the server
  // as a whole stays under AniList's limit. A chat search goes ahead of them.
  const anilistPacer = createAniListPacer(
    options.anilist?.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS,
  );
  const syncAniList = createAniListClient({
    apiUrl: config.anilist.apiUrl,
    retry: options.anilist?.retry ?? { retries: 1, baseDelayMs: 500, maxDelayMs: 2_000 },
    pacer: anilistPacer,
  });
  // One refresh per user at a time; a sync while one runs doesn't queue another.
  const airingRefreshes = new Map<string, Promise<void>>();
  // The season lineup is shared: users whose syncs overlap wait on the same rebuild.
  let seasonRefresh: Promise<number | null> | null = null;
  const refreshSeasonOnce = () =>
    (seasonRefresh ??= refreshSeason({ db, anilist: syncAniList }).finally(() => {
      seasonRefresh = null;
    }));
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
      // What's airing now, shared by every user: at most daily. Before discovery,
      // which stays the last step (its run marks the background work done).
      .then(refreshSeasonOnce)
      .then(() => undefined)
      .catch((err: unknown) => {
        app.log.warn({ err: { name: (err as Error).name } }, "could not refresh this season");
      })
      // Shows new to the user, for recommendations: at most daily, and never in the way of the
      // airing data above. It records its own failures.
      .then(() => refreshDiscovery({ db, anilist: syncAniList, log: app.log }, userId))
      .then(() => undefined)
      .catch((err: unknown) => {
        app.log.warn({ err: { name: (err as Error).name } }, "could not refresh discovery");
      })
      // Milestone 7's lab: title vectors for the list's shows, for search by meaning (only
      // new or renamed shows are embedded).
      .then(async () => {
        if (!embedder) return;
        const listed = await db
          .select({ id: listEntries.animeId })
          .from(listEntries)
          .where(eq(listEntries.userId, userId));
        await ensureTitleEmbeddings(
          { db, embedder },
          listed.map((row) => row.id),
        );
      })
      .catch((err: unknown) => {
        app.log.warn({ err: { name: (err as Error).name } }, "could not embed list titles");
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
  // Friends' model budgets; the owner, and everyone while sign-up is open, is never limited.
  const budget = (user: { id: string; isOwner: boolean }) =>
    checkBudget(db, modelsFile, config.budget, user);
  const configuredRoles = resolveRoles(modelsFile, config.llm.overrides);
  const models =
    options.models ??
    createModelClient({
      geminiApiKey: config.llm.geminiApiKey,
      ollamaBaseUrl: config.llm.ollamaBaseUrl,
      ollama: modelsFile.ollama,
    });
  // Milestone 7's lab: list search by meaning, only when SEARCH_VECTORS is on.
  const embedder = config.lab.searchVectors
    ? createEmbedder({
        ref: resolveEmbedding(modelsFile, config.llm.embeddingModel ?? undefined),
        geminiApiKey: config.llm.geminiApiKey,
        ollamaBaseUrl: config.llm.ollamaBaseUrl,
        ollama: modelsFile.ollama,
      })
    : null;
  const malWrites = {
    tokenStore,
    apiBaseUrl: config.mal.apiBaseUrl,
    ...(options.malRetry ? { retry: options.malRetry } : {}),
  };
  const writeListStatus = createMalListWriter(malWrites);
  // Chat's searches of all anime get their own AniList client, so they never queue behind a
  // background airing refresh.
  const chatAniList = createAniListClient({
    apiUrl: config.anilist.apiUrl,
    ...options.anilist,
    pacer: anilistPacer,
    urgent: true,
  });

  // A show's page fetches its synopsis the first time anyone opens it, while they wait, and its
  // airing and where to watch in the background when they're missing or old.
  const synopsis = createSynopsisLoader({
    db,
    anilist: chatAniList,
    onError: (err) => {
      app.log.warn({ err: { name: (err as Error).name } }, "could not fetch a synopsis");
    },
  });
  const showRefreshes = new Map<string, Promise<void>>();
  app.addHook("onClose", async () => {
    await Promise.allSettled([synopsis.settle(), ...showRefreshes.values()]);
  });
  /** One background lookup per show and kind at a time, however many pages ask. */
  const refreshInBackground = (key: string, work: () => Promise<unknown>, what: string) => {
    if (showRefreshes.has(key)) return;
    const task: Promise<void> = work()
      .then(() => undefined)
      .catch((err: unknown) => {
        app.log.warn({ err: { name: (err as Error).name } }, `could not refresh a show's ${what}`);
      })
      .finally(() => showRefreshes.delete(key));
    showRefreshes.set(key, task);
  };
  const refreshShowAiring = (malId: number) => {
    refreshInBackground(
      `airing:${String(malId)}`,
      () => refreshAiring({ db, anilist: syncAniList, log: app.log }, [malId]),
      "airing",
    );
  };
  const refreshShowSequels = (malId: number) => {
    refreshInBackground(
      `sequels:${String(malId)}`,
      () => refreshSequels({ db, anilist: syncAniList }, [malId]),
      "sequels",
    );
  };

  const push = createPushSender({
    db,
    vapid: config.push,
    log: app.log,
    ...(options.pushOrigins ? { extraOrigins: options.pushOrigins } : {}),
  });
  if (!config.push) app.log.info("VAPID keys not set; push notifications are off");

  const briefDeps = {
    db,
    anilist: createAniListClient({
      apiUrl: config.anilist.apiUrl,
      ...options.anilist,
      pacer: anilistPacer,
    }),
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
  // For the hosted app's healthcheck: the server is up and can reach its database.
  // Docker asks every 30 s, so its requests aren't logged.
  app.get("/health/db", { logLevel: "warn" }, async (_request, reply) => {
    try {
      await db.execute(sql`select 1`);
      return { status: "ok" };
    } catch {
      return reply.code(503).send({ status: "unavailable" });
    }
  });
  registerAuthRoutes(app, { config, db, cipher, tokenStore, listSync });
  registerInviteRoutes(app, { config, db });
  registerFriendRoutes(app, { config, db, cipher });
  // Every write to MAL, from Chat, the List screen or an import, goes through these.
  const writeDeps = {
    db,
    writeListStatus,
    removeListStatus: createMalListRemover(malWrites),
    refreshAnime: createAnimeRefresher({ db, ...malWrites }),
  };
  registerListRoutes(app, { config, db, listSync, writes: writeDeps });
  registerTasteRoutes(app, { config, db });
  registerStatsRoutes(app, { config, db });
  registerDiaryRoutes(app, { config, db });
  registerShowRoutes(app, {
    db,
    synopsis,
    refreshAiring: refreshShowAiring,
    refreshSequels: refreshShowSequels,
    catalog: (queries) => chatAniList.searchAnime(queries),
  });
  registerPushRoutes(app, {
    config,
    db,
    push,
    ...(options.pushOrigins ? { extraOrigins: options.pushOrigins } : {}),
  });
  registerBriefRoutes(app, { ...briefDeps, config });
  // Diary reactions are read after a message's updates commit, in the background, so the reply
  // never waits on them. Shutdown waits for any still running.
  const diaryReads = new Set<Promise<void>>();
  app.addHook("onClose", async () => {
    await Promise.allSettled(diaryReads);
  });
  const diaryModel = options.roles?.agent ?? configuredRoles.agent;
  const readDiary = (
    userId: string,
    message: string,
    committed: { animeId: number; changeId: string }[],
  ) => {
    const task: Promise<void> = saveReactionsFor(
      { db, models, model: diaryModel, prompt: DIARY_PROMPT },
      userId,
      message,
      committed,
    )
      .then(() => undefined)
      .catch((err: unknown) => {
        app.log.warn({ err: { name: (err as Error).name } }, "could not read diary reactions");
      })
      .finally(() => diaryReads.delete(task));
    diaryReads.add(task);
  };
  // Replies that may have gone wrong go to the review queue in the background, so a reply or an
  // undo never waits on it. Shutdown waits for any still running.
  const reviewCaptures = new Set<Promise<void>>();
  app.addHook("onClose", async () => {
    await Promise.allSettled(reviewCaptures);
  });
  const queueReview = (input: Parameters<typeof captureReview>[1]) => {
    const task: Promise<void> = captureReview(db, input)
      .then(() => undefined)
      .catch((err: unknown) => {
        app.log.warn({ err: { name: (err as Error).name } }, "could not queue a reply for review");
      })
      .finally(() => reviewCaptures.delete(task));
    reviewCaptures.add(task);
  };
  registerChatRoutes(app, {
    config,
    db,
    models,
    ...(embedder && {
      meaning: {
        embedder,
        onError: (err: unknown) => {
          app.log.warn({ err: { name: (err as Error).name } }, "list search by meaning failed");
        },
      },
    }),
    writeListStatus: writeDeps.writeListStatus,
    removeListStatus: writeDeps.removeListStatus,
    refreshAnime: writeDeps.refreshAnime,
    catalog: (queries) => chatAniList.searchAnime(queries),
    prompt: options.prompt ?? CURRENT_PROMPT,
    recommendPrompt: RECOMMEND_PROMPT,
    budget,
    ...(options.diary !== false && { diary: readDiary }),
    review: queueReview,
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
  registerImportRoutes(app, { ...importDeps, config, budget });
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
