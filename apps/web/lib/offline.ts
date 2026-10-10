import { listResponseSchema, type ListEntry, type ListResponse } from "@kurisu/shared";

/**
 * The browser's copy of the user's list, for the offline page. The List screen saves what the
 * server rendered (no extra request), and logging out or deleting the account clears it.
 * public/sw.js keeps this cache when it clears its own, so the name must match there.
 */
export const DATA_CACHE = "kurisu-data";
const LIST_KEY = "/offline/list.json";

/** Saves the list as the List screen shows it. Fails quietly: it's only for offline. */
export async function rememberList(list: ListResponse): Promise<void> {
  try {
    if (!("caches" in window)) return;
    const cache = await caches.open(DATA_CACHE);
    await cache.put(
      LIST_KEY,
      new Response(JSON.stringify({ ...list, savedAt: new Date().toISOString() }), {
        headers: { "content-type": "application/json" },
      }),
    );
  } catch {
    // Storage can be full or refused (a private window); the offline page then says so.
  }
}

/** The list last saved on this device, and when; null when there isn't one. */
export async function readList(): Promise<{ entries: ListEntry[]; savedAt: string } | null> {
  try {
    if (!("caches" in window)) return null;
    const cache = await caches.open(DATA_CACHE);
    const response = await cache.match(LIST_KEY);
    if (!response) return null;
    const body = (await response.json()) as Record<string, unknown>;
    const list = listResponseSchema.parse(body);
    return {
      entries: list.entries,
      savedAt: typeof body.savedAt === "string" ? body.savedAt : new Date(0).toISOString(),
    };
  } catch {
    return null;
  }
}

/** Forgets the list on this device: on logout, and when the account is deleted. */
export async function forgetOfflineData(): Promise<void> {
  try {
    if ("caches" in window) await caches.delete(DATA_CACHE);
  } catch {
    // Nothing more to do; the next login overwrites it.
  }
}
