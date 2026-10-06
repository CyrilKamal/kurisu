import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * A fake MyAnimeList for integration tests: a real HTTP server implementing the OAuth
 * authorize/token endpoints and the API endpoints the app calls. It enforces MAL's rules,
 * most importantly that PKCE uses the `plain` method, so the token exchange only succeeds
 * when `code_verifier` equals the `code_challenge` sent to the authorize endpoint.
 */

export interface FakeMalOptions {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  user: { id: number; name: string };
}

interface IssuedCode {
  challenge: string;
  redirectUri: string;
  used: boolean;
}

/** One entry of the fake user's MAL anime list, in MAL's API shape. */
export interface FakeListItem {
  node: {
    id: number;
    title: string;
    main_picture?: { medium: string; large: string };
    alternative_titles?: { synonyms: string[]; en: string; ja: string };
    media_type: string;
    num_episodes: number;
    status: string;
    start_date?: string;
    genres?: { id: number; name: string }[];
    average_episode_duration?: number;
    mean?: number;
  };
  list_status: {
    status: "watching" | "completed" | "on_hold" | "dropped" | "plan_to_watch";
    score: number;
    num_episodes_watched: number;
    is_rewatching: boolean;
    updated_at: string;
    start_date?: string;
    finish_date?: string;
  };
}

export class FakeMal {
  /** Access-token lifetime MAL reports in `expires_in`. */
  accessTokenLifetimeSeconds = 2_678_400;
  /** Grant types received by the token endpoint, in order. */
  readonly tokenGrants: string[] = [];
  /** Every secret handed out (codes, verifiers, tokens), so tests can check none reach the logs. */
  readonly issuedSecrets: string[] = [];

  /** The user's list as MAL would return it. */
  list: FakeListItem[] = [];
  /** Page size the fake uses, whatever `limit` the client asks for, so tests can force paging. */
  pageSize = 1000;
  /** Status codes to return for the next anime-list requests, in order (e.g. [503, 429]). */
  animeListFailures: number[] = [];
  /** If set, the first page's `paging.next` points here instead of the real next page. */
  nextPageOverride: string | undefined;
  /** If set, every anime-list request at or past this offset gets a 503 (MAL down mid-sync). */
  unavailableFromOffset: number | undefined;
  /** Every anime-list request URL received, to check query parameters. */
  readonly animeListRequests: URL[] = [];
  /** Every list-status PATCH received: the anime and the form fields sent. */
  readonly patchRequests: { animeId: number; form: Record<string, string> }[] = [];
  /** Status codes to return for the next PATCHes, in order (e.g. [503]). */
  patchFailures: number[] = [];

  private readonly codes = new Map<string, IssuedCode>();
  private readonly accessTokens = new Map<string, number>(); // token -> expiry (ms epoch)
  private readonly refreshTokens = new Set<string>();

  private constructor(
    private readonly options: FakeMalOptions,
    private readonly server: Server,
    readonly baseUrl: string,
  ) {}

  /** Starts on `port`, or a random free port if omitted (tests). */
  static async start(options: FakeMalOptions, port = 0): Promise<FakeMal> {
    // The handler needs the instance, and the instance needs the listening server's port.
    const ref: { fake?: FakeMal } = {};
    const server = createServer((req, res) => {
      if (!ref.fake) throw new Error("fake MAL not ready");
      ref.fake.handle(req, res).catch((err: unknown) => {
        res.writeHead(500).end(String(err));
      });
    });
    await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
    const bound = (server.address() as AddressInfo).port;
    ref.fake = new FakeMal(options, server, `http://127.0.0.1:${String(bound)}`);
    return ref.fake;
  }

  get authBaseUrl(): string {
    return `${this.baseUrl}/v1/oauth2`;
  }

  get apiBaseUrl(): string {
    return `${this.baseUrl}/v2`;
  }

  /** Simulates the user revoking the app on MAL: every refresh token stops working. */
  revokeRefreshTokens(): void {
    this.refreshTokens.clear();
  }

  /** Makes MAL reject every current access token, even though they haven't expired. */
  invalidateAccessTokens(): void {
    this.accessTokens.clear();
  }

  reset(): void {
    this.tokenGrants.length = 0;
    this.codes.clear();
    this.accessTokens.clear();
    this.refreshTokens.clear();
    this.list = [];
    this.pageSize = 1000;
    this.animeListFailures = [];
    this.nextPageOverride = undefined;
    this.unavailableFromOffset = undefined;
    this.animeListRequests.length = 0;
    this.patchRequests.length = 0;
    this.patchFailures = [];
  }

  stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", this.baseUrl);
    if (req.method === "GET" && url.pathname === "/v1/oauth2/authorize") {
      this.authorize(url, res);
      return;
    }
    if (req.method === "POST" && url.pathname === "/v1/oauth2/token") {
      this.token(new URLSearchParams(await readBody(req)), res);
      return;
    }
    if (req.method === "GET" && url.pathname === "/v2/users/@me") {
      if (!this.isAuthorized(req)) {
        json(res, 401, { error: "invalid_token" });
        return;
      }
      json(res, 200, { id: this.options.user.id, name: this.options.user.name });
      return;
    }
    const patch = /^\/v2\/anime\/(\d+)\/my_list_status$/.exec(url.pathname);
    if (req.method === "PATCH" && patch?.[1]) {
      this.patchListStatus(Number(patch[1]), new URLSearchParams(await readBody(req)), req, res);
      return;
    }
    if (req.method === "GET" && url.pathname === "/v2/users/@me/animelist") {
      this.animeList(url, req, res);
      return;
    }
    json(res, 404, { error: "not_found" });
  }

  /** MAL's list-status update: applies the form fields and returns the entry's new state. */
  private patchListStatus(
    animeId: number,
    form: URLSearchParams,
    req: IncomingMessage,
    res: ServerResponse,
  ): void {
    this.patchRequests.push({ animeId, form: Object.fromEntries(form) });
    const failure = this.patchFailures.shift();
    if (failure !== undefined) {
      json(res, failure, { error: "injected_failure" });
      return;
    }
    if (!this.isAuthorized(req)) {
      json(res, 401, { error: "invalid_token" });
      return;
    }
    const item = this.list.find((i) => i.node.id === animeId);
    if (!item) {
      json(res, 404, { error: "not_found" });
      return;
    }
    const ls = item.list_status;
    const status = form.get("status");
    if (status) ls.status = status as typeof ls.status;
    const episodes = form.get("num_watched_episodes");
    if (episodes !== null) ls.num_episodes_watched = Number(episodes);
    const score = form.get("score");
    if (score !== null) ls.score = Number(score);
    const rewatching = form.get("is_rewatching");
    if (rewatching !== null) ls.is_rewatching = rewatching === "true";
    ls.updated_at = new Date().toISOString().replace("Z", "+00:00");
    json(res, 200, {
      status: ls.status,
      score: ls.score,
      num_episodes_watched: ls.num_episodes_watched,
      is_rewatching: ls.is_rewatching,
      updated_at: ls.updated_at,
    });
  }

  private animeList(url: URL, req: IncomingMessage, res: ServerResponse): void {
    this.animeListRequests.push(url);
    const failure = this.animeListFailures.shift();
    if (failure !== undefined) {
      res.writeHead(failure, failure === 429 ? { "retry-after": "0" } : {}).end();
      return;
    }
    if (!this.isAuthorized(req)) {
      json(res, 401, { error: "invalid_token" });
      return;
    }

    const offset = Number(url.searchParams.get("offset") ?? "0");
    if (this.unavailableFromOffset !== undefined && offset >= this.unavailableFromOffset) {
      res.writeHead(503).end();
      return;
    }
    const data = this.list.slice(offset, offset + this.pageSize);
    const paging: { next?: string } = {};
    if (offset + this.pageSize < this.list.length) {
      const next = new URL(url);
      next.searchParams.set("offset", String(offset + this.pageSize));
      paging.next = this.nextPageOverride ?? next.toString();
    }
    json(res, 200, { data, paging });
  }

  /** The consent screen, auto-approved: redirects back with a code, like MAL after "Allow". */
  private authorize(url: URL, res: ServerResponse): void {
    const params = url.searchParams;
    const challenge = params.get("code_challenge") ?? "";
    const method = params.get("code_challenge_method") ?? "plain";
    const redirectUri = params.get("redirect_uri") ?? this.options.redirectUri;

    if (
      params.get("response_type") !== "code" ||
      params.get("client_id") !== this.options.clientId
    ) {
      json(res, 400, { error: "invalid_request" });
      return;
    }
    if (method !== "plain") {
      json(res, 400, { error: "invalid_request", message: "only plain is supported" });
      return;
    }
    if (challenge.length < 43 || challenge.length > 128) {
      json(res, 400, { error: "invalid_request", message: "code_challenge length" });
      return;
    }
    if (redirectUri !== this.options.redirectUri) {
      json(res, 400, { error: "invalid_request", message: "redirect_uri mismatch" });
      return;
    }

    const code = secret();
    this.codes.set(code, { challenge, redirectUri, used: false });
    this.issuedSecrets.push(code, challenge);

    const callback = new URL(redirectUri);
    callback.searchParams.set("code", code);
    const state = params.get("state");
    if (state !== null) callback.searchParams.set("state", state);
    res.writeHead(302, { location: callback.toString() }).end();
  }

  private token(form: URLSearchParams, res: ServerResponse): void {
    const grantType = form.get("grant_type") ?? "";
    this.tokenGrants.push(grantType);

    if (
      form.get("client_id") !== this.options.clientId ||
      form.get("client_secret") !== this.options.clientSecret
    ) {
      json(res, 401, { error: "invalid_client" });
      return;
    }

    if (grantType === "authorization_code") {
      const issued = this.codes.get(form.get("code") ?? "");
      if (
        !issued ||
        issued.used ||
        form.get("redirect_uri") !== issued.redirectUri ||
        // plain PKCE: the verifier must be exactly the challenge.
        form.get("code_verifier") !== issued.challenge
      ) {
        json(res, 400, { error: "invalid_grant" });
        return;
      }
      issued.used = true;
      json(res, 200, this.issueTokens());
      return;
    }

    if (grantType === "refresh_token") {
      const refreshToken = form.get("refresh_token") ?? "";
      if (!this.refreshTokens.delete(refreshToken)) {
        json(res, 400, { error: "invalid_grant" });
        return;
      }
      json(res, 200, this.issueTokens());
      return;
    }

    json(res, 400, { error: "unsupported_grant_type" });
  }

  private issueTokens() {
    const accessToken = secret();
    const refreshToken = secret();
    this.accessTokens.set(accessToken, Date.now() + this.accessTokenLifetimeSeconds * 1000);
    this.refreshTokens.add(refreshToken);
    this.issuedSecrets.push(accessToken, refreshToken);
    return {
      token_type: "Bearer",
      expires_in: this.accessTokenLifetimeSeconds,
      access_token: accessToken,
      refresh_token: refreshToken,
    };
  }

  private isAuthorized(req: IncomingMessage): boolean {
    const token = /^Bearer (.+)$/.exec(req.headers.authorization ?? "")?.[1];
    const expiresAt = token ? this.accessTokens.get(token) : undefined;
    return expiresAt !== undefined && expiresAt > Date.now();
  }
}

function secret(): string {
  return randomBytes(24).toString("base64url");
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}
