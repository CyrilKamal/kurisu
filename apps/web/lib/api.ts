import "server-only";

import { SESSION_COOKIE } from "@kurisu/shared";
import { cookies } from "next/headers";
import type { z } from "zod";

import { apiInternalUrl } from "./apiInternalUrl";

/**
 * GETs a server API route from a Server Component, forwarding only the session cookie, and
 * validates the response against the shared contract. Returns null when the session is missing
 * or no longer valid, so pages can send the user to log in.
 */
export async function apiGet<T>(path: string, schema: z.ZodType<T>): Promise<T | null> {
  const session = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!session) return null;

  const res = await fetch(`${apiInternalUrl()}${path}`, {
    headers: { cookie: `${SESSION_COOKIE}=${session}`, accept: "application/json" },
    cache: "no-store",
  });
  if (res.status === 401) return null;
  if (!res.ok) {
    throw new Error(`API ${path} returned ${String(res.status)}`);
  }
  return schema.parse(await res.json());
}
