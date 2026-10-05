import { eq, inArray } from "drizzle-orm";
import type { FastifyBaseLogger } from "fastify";
import webpush from "web-push";

import type { Config } from "../config.js";
import type { Db } from "../db/client.js";
import { pushSubscriptions } from "../db/schema.js";

/** What the service worker shows. `url` is where tapping the notification goes. */
export interface PushPayload {
  title: string;
  body: string;
  url: string;
  /** Notifications with the same tag replace each other instead of stacking. */
  tag?: string;
}

export interface PushResult {
  sent: number;
  /** Subscriptions the push service said are gone (404/410); they're deleted. */
  removed: number;
  failed: number;
}

export interface PushSender {
  /** The VAPID public key browsers subscribe with, or null when push is off. */
  readonly publicKey: string | null;
  sendToUser(userId: string, payload: PushPayload): Promise<PushResult>;
}

/**
 * Browsers' push services. The server only ever sends to these, so a crafted subscription
 * can't point it at another host.
 */
const PUSH_SERVICE_HOSTS = [
  "fcm.googleapis.com", // Chrome, Android, Samsung Internet
  "updates.push.services.mozilla.com", // Firefox
  "web.push.apple.com", // Safari, iOS home-screen apps
];
const PUSH_SERVICE_HOST_SUFFIXES = [".notify.windows.com", ".push.apple.com"]; // Edge, Safari

/** How long a push service holds a message for an offline device. */
const TTL_SECONDS = 12 * 60 * 60;

/** Whether the endpoint is on a known push service (or one of `extraOrigins`, for tests). */
export function isAllowedPushEndpoint(endpoint: string, extraOrigins: string[] = []): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (extraOrigins.includes(url.origin)) return true;
  if (url.protocol !== "https:" || url.port !== "") return false;
  return (
    PUSH_SERVICE_HOSTS.includes(url.hostname) ||
    PUSH_SERVICE_HOST_SUFFIXES.some((suffix) => url.hostname.endsWith(suffix))
  );
}

export function createPushSender(deps: {
  db: Db;
  vapid: Config["push"];
  log: FastifyBaseLogger;
  /** Extra push-service origins to allow; tests use a local fake. */
  extraOrigins?: string[];
}): PushSender {
  const { db, vapid, log } = deps;
  const extraOrigins = deps.extraOrigins ?? [];

  return {
    publicKey: vapid?.publicKey ?? null,

    async sendToUser(userId, payload) {
      const result: PushResult = { sent: 0, removed: 0, failed: 0 };
      if (!vapid) return result;

      const subscriptions = await db
        .select()
        .from(pushSubscriptions)
        .where(eq(pushSubscriptions.userId, userId));
      const delivered: string[] = [];
      const gone: string[] = [];

      for (const sub of subscriptions) {
        if (!isAllowedPushEndpoint(sub.endpoint, extraOrigins)) {
          gone.push(sub.id);
          continue;
        }
        // web-push encrypts and signs; we send it ourselves so tests can use a plain HTTP fake.
        const request = webpush.generateRequestDetails(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify(payload),
          {
            vapidDetails: vapid,
            TTL: TTL_SECONDS,
            urgency: "normal",
            contentEncoding: "aes128gcm",
            ...(payload.tag ? { topic: topicFor(payload.tag) } : {}),
          },
        );
        const headers = Object.fromEntries(
          Object.entries(request.headers).filter(
            ([name]) => name.toLowerCase() !== "content-length",
          ),
        );
        try {
          const res = await fetch(request.endpoint, {
            method: "POST",
            headers,
            body: request.body,
            signal: AbortSignal.timeout(10_000),
          });
          await res.body?.cancel();
          if (res.ok) {
            delivered.push(sub.id);
          } else if (res.status === 404 || res.status === 410) {
            gone.push(sub.id);
          } else {
            result.failed++;
            log.warn({ status: res.status }, "push service rejected a notification");
          }
        } catch (err) {
          result.failed++;
          log.warn({ err: { name: (err as Error).name } }, "could not reach a push service");
        }
      }

      if (delivered.length > 0) {
        await db
          .update(pushSubscriptions)
          .set({ lastSentAt: new Date() })
          .where(inArray(pushSubscriptions.id, delivered));
      }
      if (gone.length > 0) {
        await db.delete(pushSubscriptions).where(inArray(pushSubscriptions.id, gone));
      }
      result.sent = delivered.length;
      result.removed = gone.length;
      return result;
    },
  };
}

/** Push services allow topics of up to 32 URL-safe characters. */
function topicFor(tag: string): string {
  return tag.replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 32);
}

/** A new VAPID key pair, base64url. Only the key script uses this. */
export function generateVapidKeys(): { publicKey: string; privateKey: string } {
  return webpush.generateVAPIDKeys();
}
