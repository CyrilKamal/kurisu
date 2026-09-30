import { z } from "zod";

import { CODE_CHALLENGE_METHOD } from "./pkce.js";

export interface MalOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  authBaseUrl: string;
}

const tokenResponseSchema = z.object({
  token_type: z.string(),
  expires_in: z.number().int().positive(),
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
});

export interface MalTokens {
  accessToken: string;
  refreshToken: string;
  /** Seconds until the access token expires, as reported by MAL. */
  expiresIn: number;
}

/**
 * A failed call to MAL's token endpoint. Carries only the HTTP status and MAL's error code
 * (e.g. `invalid_grant`), never request or response bodies, which contain secrets.
 */
export class MalOAuthError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(`MAL token endpoint returned ${String(status)} (${code})`);
    this.name = "MalOAuthError";
  }

  /** True when the grant itself was rejected, as opposed to a transient failure. */
  get isGrantRejected(): boolean {
    return this.status === 400 || this.status === 401;
  }
}

export function buildAuthorizeUrl(
  config: MalOAuthConfig,
  params: { state: string; codeChallenge: string },
): string {
  const url = new URL(`${config.authBaseUrl}/authorize`);
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: config.clientId,
    code_challenge: params.codeChallenge,
    code_challenge_method: CODE_CHALLENGE_METHOD,
    state: params.state,
    redirect_uri: config.redirectUri,
  }).toString();
  return url.toString();
}

export function exchangeCode(
  config: MalOAuthConfig,
  params: { code: string; codeVerifier: string },
): Promise<MalTokens> {
  return requestTokens(config, {
    grant_type: "authorization_code",
    code: params.code,
    code_verifier: params.codeVerifier,
    redirect_uri: config.redirectUri,
  });
}

export function refreshTokens(config: MalOAuthConfig, refreshToken: string): Promise<MalTokens> {
  return requestTokens(config, { grant_type: "refresh_token", refresh_token: refreshToken });
}

async function requestTokens(
  config: MalOAuthConfig,
  grant: Record<string, string>,
): Promise<MalTokens> {
  // "web" MAL apps are confidential clients: the secret goes in the form body.
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    ...grant,
  });

  const res = await fetch(`${config.authBaseUrl}/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body,
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    throw new MalOAuthError(res.status, await readErrorCode(res));
  }

  const parsed = tokenResponseSchema.safeParse(await res.json());
  if (!parsed.success) {
    throw new MalOAuthError(res.status, "malformed_token_response");
  }
  return {
    accessToken: parsed.data.access_token,
    refreshToken: parsed.data.refresh_token,
    expiresIn: parsed.data.expires_in,
  };
}

async function readErrorCode(res: Response): Promise<string> {
  try {
    const body: unknown = await res.json();
    const parsed = z.object({ error: z.string().regex(/^[a-z_]{1,64}$/) }).safeParse(body);
    return parsed.success ? parsed.data.error : "unknown_error";
  } catch {
    return "unknown_error";
  }
}
