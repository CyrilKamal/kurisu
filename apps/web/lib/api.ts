import "server-only";

import { SESSION_COOKIE } from "@kurisu/shared";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import type { z } from "zod";

import { apiInternalUrl } from "./apiInternalUrl";

/**
 * GETs a server API route from a Server Component, forwarding only the session cookie, and
 * validates the response against the shared contract. Returns null when the session is missing
 * or no longer valid, so pages can send the user to log in. A 404 shows the page's not-found UI.
 */
export async function apiGet<T>(path: string, schema: z.ZodType<T>): Promise<T | null> {
  const session = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!session) return null;

  const res = await fetch(`${apiInternalUrl()}${path}`, {
    headers: { cookie: `${SESSION_COOKIE}=${session}`, accept: "application/json" },
    cache: "no-store",
  });
  if (res.status === 401) return null;
  if (res.status === 404) notFound();
  if (!res.ok) {
    throw new Error(`API ${path} returned ${String(res.status)}`);
  }
  return schema.parse(await res.json());
}

/** GETs a route that needs no session, like an invite's check. Returns null on a 404. */
export async function apiGetPublic<T>(path: string, schema: z.ZodType<T>): Promise<T | null> {
  const res = await fetch(`${apiInternalUrl()}${path}`, {
    headers: { accept: "application/json" },
    cache: "no-store",
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`API ${path} returned ${String(res.status)}`);
  }
  return schema.parse(await res.json());
}
