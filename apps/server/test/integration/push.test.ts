import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { SESSION_COOKIE } from "../../src/auth/sessions.js";
import { pushSubscriptions, users } from "../../src/db/schema.js";
import { generateVapidKeys } from "../../src/push/send.js";
import { fixtureList } from "../fixtures/animeList.js";
import { FakePushService, type FakeBrowser } from "../support/fakePushService.js";
import { login, resetDatabase, startHarness, type Harness } from "../support/harness.js";
import { TEST_WEB_ORIGIN } from "../support/testConfig.js";

let h: Harness;
let pushService: FakePushService;
let cookie: string;
const vapid = generateVapidKeys();

beforeAll(async () => {
  pushService = await FakePushService.start();
  h = await startHarness({
    env: {
      VAPID_PUBLIC_KEY: vapid.publicKey,
      VAPID_PRIVATE_KEY: vapid.privateKey,
      VAPID_SUBJECT: "mailto:test@example.com",
    },
    pushOrigins: [pushService.origin],
  });
});

afterAll(async () => {
  await h.close();
  await pushService.stop();
});

beforeEach(async () => {
  await resetDatabase(h.db);
  h.fakeMal.reset();
  h.fakeMal.list = fixtureList();
  pushService.reset();
  const result = await login(h);
  if (!result.sessionCookie) throw new Error("login failed");
  cookie = result.sessionCookie;
});

function request(
  method: "GET" | "POST" | "DELETE",
  url: string,
  body?: unknown,
  options: { cookie?: string; origin?: string | null } = {},
) {
  const origin = options.origin === undefined ? TEST_WEB_ORIGIN : options.origin;
  return h.app.inject({
    method,
    url,
    headers: origin ? { origin } : {},
    cookies: { [SESSION_COOKIE]: options.cookie ?? cookie },
    ...(body === undefined ? {} : { payload: body as Record<string, unknown> }),
  });
}

const subscribe = (browser: FakeBrowser, options?: { cookie?: string }) =>
  request("POST", "/push/subscriptions", browser.subscription, options);

async function storedEndpoints(): Promise<string[]> {
  const rows = await h.db.select({ endpoint: pushSubscriptions.endpoint }).from(pushSubscriptions);
  return rows.map((r) => r.endpoint).sort();
}

describe("subscriptions", () => {
  it("serves the VAPID public key", async () => {
    const res = await request("GET", "/push/public-key");
    expect(res.json()).toEqual({ publicKey: vapid.publicKey });
  });

  it("stores a subscription and removes it on unsubscribe", async () => {
    const browser = pushService.browser("laptop");

    expect((await subscribe(browser)).json()).toEqual({ subscribed: true });
    expect(await subscribe(browser)).toMatchObject({ statusCode: 200 }); // idempotent
    expect(await storedEndpoints()).toEqual([browser.subscription.endpoint]);

    const res = await request("DELETE", "/push/subscriptions", {
      endpoint: browser.subscription.endpoint,
    });
    expect(res.json()).toEqual({ subscribed: false });
    expect(await storedEndpoints()).toEqual([]);
  });

  it("only accepts endpoints on known push services", async () => {
    const keys = pushService.browser("x").subscription.keys;
    for (const endpoint of [
      "https://evil.example/push/1",
      "http://169.254.169.254/latest/meta-data",
      "https://fcm.googleapis.com.evil.example/x",
      "https://fcm.googleapis.com:8443/x",
      "not a url",
    ]) {
      const res = await request("POST", "/push/subscriptions", { endpoint, keys });
      expect(res.json(), endpoint).toEqual({ error: "unsupported_push_service" });
    }
    expect(await storedEndpoints()).toEqual([]);
  });

  it("rejects malformed bodies, other origins and missing sessions", async () => {
    const browser = pushService.browser("laptop");
    expect(
      (
        await request("POST", "/push/subscriptions", { endpoint: "x", keys: { p256dh: "!" } })
      ).json(),
    ).toEqual({ error: "invalid_subscription" });
    expect(
      (
        await request("POST", "/push/subscriptions", browser.subscription, {
          origin: "https://evil.example",
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (await request("POST", "/push/subscriptions", browser.subscription, { cookie: "nope" }))
        .statusCode,
    ).toBe(401);
  });

  it("moves a browser's subscription to whoever subscribes with it last", async () => {
    const browser = pushService.browser("shared");
    await subscribe(browser);
    const [first] = await h.db.select().from(pushSubscriptions);

    const [other] = await h.db
      .insert(users)
      .values({ malUserId: 999, malUsername: "other" })
      .returning();
    if (!other || !first) throw new Error("setup failed");
    await h.db.update(pushSubscriptions).set({ userId: other.id });
    await subscribe(browser);

    const [row] = await h.db.select().from(pushSubscriptions);
    expect(row?.userId).toBe(first.userId);
  });
});

describe("sending", () => {
  it("sends an encrypted, signed notification the browser can read", async () => {
    const browser = pushService.browser("laptop");
    await subscribe(browser);

    const res = await request("POST", "/push/test");

    expect(res.json()).toEqual({ sent: 1, removed: 0, failed: 0 });
    expect(pushService.received).toHaveLength(1);
    const [push] = pushService.received;
    if (!push) throw new Error("no push");
    expect(push.path).toBe("/push/laptop");
    expect(push.headers["content-encoding"]).toBe("aes128gcm");
    expect(push.headers.ttl).toBe("43200");
    expect(push.headers.authorization).toMatch(
      new RegExp(`^vapid t=[\\w-]+\\.[\\w-]+\\.[\\w-]+, k=${vapid.publicKey}$`),
    );
    expect(JSON.parse(browser.decrypt(push.body))).toEqual({
      title: "Notifications are on",
      body: "Your morning brief will show up here.",
      url: "/chat",
      tag: "test",
    });
    const [row] = await h.db.select().from(pushSubscriptions);
    expect(row?.lastSentAt).toBeInstanceOf(Date);
  });

  it("deletes subscriptions the push service says are gone", async () => {
    const laptop = pushService.browser("laptop");
    const phone = pushService.browser("phone");
    await subscribe(laptop);
    await subscribe(phone);
    pushService.respond("/push/phone", 410);

    const res = await request("POST", "/push/test");

    expect(res.json()).toEqual({ sent: 1, removed: 1, failed: 0 });
    expect(await storedEndpoints()).toEqual([laptop.subscription.endpoint]);
  });

  it("counts other push-service errors as failures and keeps the subscription", async () => {
    const laptop = pushService.browser("laptop");
    await subscribe(laptop);
    pushService.respond("/push/laptop", 500);

    expect((await request("POST", "/push/test")).json()).toEqual({
      sent: 0,
      removed: 0,
      failed: 1,
    });
    expect(await storedEndpoints()).toEqual([laptop.subscription.endpoint]);
  });

  it("limits test notifications and needs a subscription", async () => {
    const none = await request("POST", "/push/test");
    expect(none.statusCode).toBe(409);
    expect(none.json()).toEqual({ error: "no_subscriptions" });

    // A failed attempt still counts toward the limit, so the next one has to wait.
    const again = await request("POST", "/push/test");
    expect(again.statusCode).toBe(429);
    expect(again.json()).toEqual({ error: "too_soon" });
  });

  it("never logs subscription endpoints or keys", async () => {
    const browser = pushService.browser("secret-endpoint-path");
    await subscribe(browser);
    pushService.respond("/push/secret-endpoint-path", 500);
    await request("POST", "/push/test");

    expect(h.logs.text).not.toContain("secret-endpoint-path");
    expect(h.logs.text).not.toContain(browser.subscription.keys.auth);
    expect(h.logs.text).not.toContain(browser.subscription.keys.p256dh);
  });

  it("deletes a user's subscriptions with the user", async () => {
    await subscribe(pushService.browser("laptop"));
    await h.db.delete(users).where(eq(users.malUserId, 4242));
    expect(await storedEndpoints()).toEqual([]);
  });
});
