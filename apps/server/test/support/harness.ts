import { Writable } from "node:stream";

import { sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { inject } from "vitest";

import { buildApp, type BuildAppOptions } from "../../src/app.js";
import { OAUTH_STATE_COOKIE } from "../../src/auth/routes.js";
import { SESSION_COOKIE } from "../../src/auth/sessions.js";
import { createTokenStore, type TokenStore } from "../../src/auth/tokenStore.js";
import type { Config } from "../../src/config.js";
import { createTokenCipher, type TokenCipher } from "../../src/crypto/tokenCipher.js";
import { createDb, type Db } from "../../src/db/client.js";
import { FakeMal } from "./fakeMal.js";
import { TEST_MAL_CLIENT, testConfig } from "./testConfig.js";

export const TEST_MAL_USER = { id: 4242, name: "test_user" };

/** Collects every log line the app writes. */
export class LogCapture extends Writable {
  private readonly chunks: string[] = [];

  override _write(chunk: Buffer, _encoding: string, callback: () => void): void {
    this.chunks.push(chunk.toString("utf8"));
    callback();
  }

  get text(): string {
    return this.chunks.join("");
  }
}

export interface Harness {
  app: FastifyInstance;
  fakeMal: FakeMal;
  logs: LogCapture;
  config: Config;
  db: Db;
  cipher: TokenCipher;
  /** A separate token store over the same DB, for driving refreshes directly. */
  tokenStore: TokenStore;
  close(): Promise<void>;
}

export async function startHarness(
  options: Pick<BuildAppOptions, "models" | "roles" | "pushOrigins" | "anilist"> & {
    /** Extra environment variables, e.g. VAPID keys. */
    env?: Record<string, string>;
  } = {},
): Promise<Harness> {
  const { env, ...appOptions } = options;
  const fakeMal = await FakeMal.start({ ...TEST_MAL_CLIENT, user: TEST_MAL_USER });
  const config = testConfig({
    DATABASE_URL: inject("databaseUrl"),
    MAL_AUTH_BASE_URL: fakeMal.authBaseUrl,
    MAL_API_BASE_URL: fakeMal.apiBaseUrl,
    // Log everything, so the no-secrets-in-logs check covers debug output too.
    LOG_LEVEL: "trace",
    ...env,
  });
  const logs = new LogCapture();
  const app = buildApp(config, {
    logStream: logs,
    // Real backoff shape, millisecond delays, so retry tests stay fast.
    malRetry: { retries: 3, baseDelayMs: 1, maxDelayMs: 5 },
    // No spacing between AniList requests and quick retries, so background refreshes after
    // each login never pile up.
    anilist: { minIntervalMs: 0, retry: { retries: 1, baseDelayMs: 1, maxDelayMs: 5 } },
    ...appOptions,
  });
  await app.ready();

  const { db, close: closeDb } = createDb(config.databaseUrl);
  const cipher = createTokenCipher(config.tokenEncryptionKey);
  const tokenStore = createTokenStore({ db, cipher, oauth: config.mal });

  return {
    app,
    fakeMal,
    logs,
    config,
    db,
    cipher,
    tokenStore,
    async close() {
      await app.close();
      await closeDb();
      await fakeMal.stop();
    },
  };
}

export async function resetDatabase(db: Db): Promise<void> {
  await db.execute(
    sql`TRUNCATE users, sessions, mal_tokens, oauth_states, anime, list_entries, sync_runs, proposals, changes, agent_runs, agent_run_steps, conversations, chat_messages, anilist_media, push_subscriptions, brief_settings, briefs, taste_genres, drop_reasons CASCADE`,
  );
}

export interface LoginResult {
  /** The authorize URL the app redirected the browser to. */
  authorizeUrl: URL;
  /** The URL MAL redirected back to (on the web origin). */
  callbackUrl: URL;
  stateCookie: string;
  callbackResponse: Awaited<ReturnType<FastifyInstance["inject"]>>;
  sessionCookie: string | undefined;
}

/**
 * Drives the whole browser flow: app login redirect → MAL consent → callback.
 * `tamper` can change the callback request before it is sent, to test failure paths.
 */
export async function login(
  h: Harness,
  tamper: (req: {
    query: URLSearchParams;
    stateCookie: string | undefined;
  }) => void | Promise<void> = () => undefined,
): Promise<LoginResult> {
  const start = await h.app.inject({ method: "GET", url: "/auth/mal/login" });
  const authorizeUrl = new URL(String(start.headers.location));
  const stateCookie = start.cookies.find((c) => c.name === OAUTH_STATE_COOKIE)?.value ?? "";

  const consent = await fetch(authorizeUrl, { redirect: "manual" });
  const callbackUrl = new URL(String(consent.headers.get("location")));

  const request = { query: new URLSearchParams(callbackUrl.search), stateCookie } as {
    query: URLSearchParams;
    stateCookie: string | undefined;
  };
  await tamper(request);

  const callbackResponse = await h.app.inject({
    method: "GET",
    // The browser hits /api/auth/mal/callback on the web origin; Next proxies it here.
    url: `/auth/mal/callback?${request.query.toString()}`,
    cookies: request.stateCookie === undefined ? {} : { [OAUTH_STATE_COOKIE]: request.stateCookie },
  });
  const sessionCookie = callbackResponse.cookies.find((c) => c.name === SESSION_COOKIE)?.value;

  return { authorizeUrl, callbackUrl, stateCookie, callbackResponse, sessionCookie };
}
