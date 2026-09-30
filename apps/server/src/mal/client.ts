import { z } from "zod";

// Read-only MAL API calls. Milestone 1 has no write path: nothing here may modify a MAL list.

const meSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1),
});

export interface MalUser {
  id: number;
  name: string;
}

/** A non-2xx response from the MAL API. Never includes the access token or response body. */
export class MalApiError extends Error {
  constructor(
    readonly status: number,
    readonly path: string,
  ) {
    super(`MAL API ${path} returned ${String(status)}`);
    this.name = "MalApiError";
  }
}

export async function fetchMe(apiBaseUrl: string, accessToken: string): Promise<MalUser> {
  const path = "/users/@me";
  const res = await fetch(`${apiBaseUrl}${path}`, {
    headers: { authorization: `Bearer ${accessToken}`, accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    throw new MalApiError(res.status, path);
  }
  return meSchema.parse(await res.json());
}
