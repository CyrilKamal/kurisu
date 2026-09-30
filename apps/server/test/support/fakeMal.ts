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

export class FakeMal {
  /** Access-token lifetime MAL reports in `expires_in`. */
  accessTokenLifetimeSeconds = 2_678_400;
  /** Grant types received by the token endpoint, in order. */
  readonly tokenGrants: string[] = [];
  /** Every secret handed out (codes, verifiers, tokens), so tests can check none reach the logs. */
  readonly issuedSecrets: string[] = [];

  private readonly codes = new Map<string, IssuedCode>();
  private readonly accessTokens = new Map<string, number>(); // token -> expiry (ms epoch)
  private readonly refreshTokens = new Set<string>();

  private constructor(
    private readonly options: FakeMalOptions,
    private readonly server: Server,
    readonly baseUrl: string,
  ) {}

  static async start(options: FakeMalOptions): Promise<FakeMal> {
    // The handler needs the instance, and the instance needs the listening server's port.
    const ref: { fake?: FakeMal } = {};
    const server = createServer((req, res) => {
      if (!ref.fake) throw new Error("fake MAL not ready");
      ref.fake.handle(req, res).catch((err: unknown) => {
        res.writeHead(500).end(String(err));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    ref.fake = new FakeMal(options, server, `http://127.0.0.1:${String(port)}`);
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

  reset(): void {
    this.tokenGrants.length = 0;
    this.codes.clear();
    this.accessTokens.clear();
    this.refreshTokens.clear();
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
    json(res, 404, { error: "not_found" });
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
