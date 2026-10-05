import type { z } from "zod";

export type ApiResult<T> = { ok: true; data: T } | { ok: false; status: number; error: string };

/**
 * POSTs to the server through the same-origin /api proxy (the browser sends the session cookie
 * and Origin header). Validates success bodies against the shared contract.
 */
export function postApi<T>(
  path: string,
  schema: z.ZodType<T> | null,
  body?: unknown,
): Promise<ApiResult<T | null>> {
  return sendApi("POST", path, schema, body);
}

/** Like postApi, for PUT and DELETE. */
export async function sendApi<T>(
  method: "POST" | "PUT" | "DELETE",
  path: string,
  schema: z.ZodType<T> | null,
  body?: unknown,
): Promise<ApiResult<T | null>> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      // Only send a JSON content type with a body: the server rejects empty JSON bodies.
      ...(body === undefined
        ? {}
        : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
    });
  } catch {
    return { ok: false, status: 0, error: "network" };
  }
  if (!res.ok) {
    const payload = (await res.json().catch(() => null)) as { error?: unknown } | null;
    return {
      ok: false,
      status: res.status,
      error: typeof payload?.error === "string" ? payload.error : "unknown",
    };
  }
  if (schema === null || res.status === 204) return { ok: true, data: null };
  return { ok: true, data: schema.parse(await res.json()) };
}

export async function getApi<T>(path: string, schema: z.ZodType<T>): Promise<ApiResult<T>> {
  try {
    const res = await fetch(`/api${path}`, { cache: "no-store" });
    if (!res.ok) return { ok: false, status: res.status, error: "unknown" };
    return { ok: true, data: schema.parse(await res.json()) };
  } catch {
    return { ok: false, status: 0, error: "network" };
  }
}
