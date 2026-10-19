import * as contract from "@kurisu/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { SESSION_COOKIE } from "../../src/auth/sessions.js";
import {
  chatMessages,
  conversations,
  diaryNotes,
  malTokens,
  sessions,
  users,
} from "../../src/db/schema.js";
import { fixtureList } from "../fixtures/animeList.js";
import {
  login,
  resetDatabase,
  startHarness,
  TEST_MAL_USER,
  type Harness,
} from "../support/harness.js";
import { TEST_WEB_ORIGIN } from "../support/testConfig.js";

// The fake MAL always logs in as TEST_MAL_USER ("test_user").
describe("sign-up while kurisu has an owner", () => {
  let h: Harness;

  beforeAll(async () => {
    h = await startHarness({ env: { OWNER_MAL_USERNAME: "someone_else" } });
  });
  afterAll(() => h.close());
  beforeEach(async () => {
    await resetDatabase(h.db);
    h.fakeMal.reset();
  });

  it("turns away a MAL account that has no kurisu account, keeping nothing of it", async () => {
    const { callbackResponse, sessionCookie } = await login(h);

    expect(callbackResponse.statusCode).toBe(302);
    expect(callbackResponse.headers.location).toBe("/?login_error=invite_only");
    expect(sessionCookie).toBeUndefined();
    expect(await h.db.select().from(users)).toEqual([]);
    expect(await h.db.select().from(malTokens)).toEqual([]);
    expect(await h.db.select().from(sessions)).toEqual([]);
  });

  it("lets in an account that already exists", async () => {
    await h.db
      .insert(users)
      .values({ malUserId: TEST_MAL_USER.id, malUsername: TEST_MAL_USER.name });

    const { callbackResponse, sessionCookie } = await login(h);

    expect(callbackResponse.headers.location).toBe("/today");
    expect(sessionCookie).toBeDefined();
  });

  it("answers the database healthcheck", async () => {
    const res = await h.app.inject({ method: "GET", url: "/health/db" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
  });
});

describe("the owner's first login", () => {
  let h: Harness;

  beforeAll(async () => {
    // MAL usernames aren't case-sensitive.
    h = await startHarness({ env: { OWNER_MAL_USERNAME: TEST_MAL_USER.name.toUpperCase() } });
  });
  afterAll(() => h.close());
  beforeEach(async () => {
    await resetDatabase(h.db);
    h.fakeMal.reset();
  });

  it("creates the owner's account, without asking them to accept their own terms", async () => {
    const { callbackResponse, sessionCookie } = await login(h, undefined, undefined, {
      consent: false,
    });

    expect(callbackResponse.headers.location).toBe("/welcome");
    expect(sessionCookie).toBeDefined();
    const rows = await h.db.select({ malUsername: users.malUsername }).from(users);
    expect(rows).toEqual([{ malUsername: TEST_MAL_USER.name }]);
    const me = await h.app.inject({
      method: "GET",
      url: "/me",
      cookies: { [SESSION_COOKIE]: sessionCookie ?? "" },
    });
    expect(contract.meResponseSchema.parse(me.json()).termsAccepted).toBe(true);
  });
});

describe("open sign-up", () => {
  let h: Harness;

  beforeAll(async () => {
    h = await startHarness({ env: { OWNER_MAL_USERNAME: "someone_else", SIGNUP: "open" } });
  });
  afterAll(() => h.close());
  beforeEach(async () => {
    await resetDatabase(h.db);
    h.fakeMal.reset();
  });

  it("lets in anyone who said they're 18 or older and accepted the terms, and records it", async () => {
    const site = contract.siteResponseSchema.parse(
      (await h.app.inject({ method: "GET", url: "/site" })).json(),
    );
    expect(site.signup).toBe("open");

    const { callbackResponse, sessionCookie } = await login(h);
    expect(callbackResponse.headers.location).toBe("/welcome");
    const [user] = await h.db.select().from(users);
    expect(user).toMatchObject({
      malUsername: TEST_MAL_USER.name,
      termsVersion: contract.TERMS_VERSION,
    });
    expect(user?.ageConfirmedAt).toBeInstanceOf(Date);
    expect(user?.termsAcceptedAt).toBeInstanceOf(Date);
    const me = contract.meResponseSchema.parse(
      (
        await h.app.inject({
          method: "GET",
          url: "/me",
          cookies: { [SESSION_COOKIE]: sessionCookie ?? "" },
        })
      ).json(),
    );
    // Open sign-up keeps the plans: a new account starts on the trial.
    expect(me).toMatchObject({ termsAccepted: true, plan: { id: "premium", source: "trial" } });
  });

  it("turns away a new account that didn't accept the terms, or accepted older ones", async () => {
    for (const consent of [false, "2020-01-01"]) {
      const { callbackResponse, sessionCookie } = await login(h, undefined, undefined, { consent });

      expect(callbackResponse.headers.location).toBe("/?login_error=consent_needed");
      expect(sessionCookie).toBeUndefined();
      expect(await h.db.select().from(users)).toEqual([]);
      expect(await h.db.select().from(malTokens)).toEqual([]);
    }
  });
});

describe("accepting the terms", () => {
  let h: Harness;

  beforeAll(async () => {
    h = await startHarness({ env: { OWNER_MAL_USERNAME: "someone_else" } });
  });
  afterAll(() => h.close());
  beforeEach(async () => {
    await resetDatabase(h.db);
    h.fakeMal.reset();
  });

  it("asks an account from before the terms once, and records the version accepted", async () => {
    await h.db
      .insert(users)
      .values({ malUserId: TEST_MAL_USER.id, malUsername: TEST_MAL_USER.name });
    const { sessionCookie } = await login(h, undefined, undefined, { consent: false });
    const as = (method: "GET" | "POST", url: string, payload?: object) =>
      h.app.inject({
        method,
        url,
        headers: { origin: TEST_WEB_ORIGIN },
        cookies: { [SESSION_COOKIE]: sessionCookie ?? "" },
        ...(payload === undefined ? {} : { payload }),
      });
    const accepted = async () =>
      contract.meResponseSchema.parse((await as("GET", "/me")).json()).termsAccepted;

    expect(await accepted()).toBe(false);
    const old = await as("POST", "/me/terms", { version: "2020-01-01" });
    expect(old.statusCode).toBe(400);
    expect(old.json()).toEqual({ error: "outdated_terms" });
    expect(await accepted()).toBe(false);

    const res = await as("POST", "/me/terms", { version: contract.TERMS_VERSION });
    expect(contract.termsAcceptResponseSchema.parse(res.json())).toEqual({ termsAccepted: true });
    expect(await accepted()).toBe(true);
    const [user] = await h.db.select().from(users);
    expect(user?.termsVersion).toBe(contract.TERMS_VERSION);
  });
});

describe("the data export", () => {
  let h: Harness;

  beforeAll(async () => {
    h = await startHarness();
  });
  afterAll(() => h.close());
  beforeEach(async () => {
    await resetDatabase(h.db);
    h.fakeMal.reset();
    h.fakeMal.list = fixtureList();
  });

  it("gives back everything kurisu holds about the user, and none of its secrets", async () => {
    const { sessionCookie } = await login(h);
    const [user] = await h.db.select().from(users);
    if (!user) throw new Error("no user");
    const [chat] = await h.db
      .insert(conversations)
      .values({ userId: user.id, title: "Frieren" })
      .returning();
    if (!chat) throw new Error("no chat");
    await h.db
      .insert(chatMessages)
      .values({ conversationId: chat.id, role: "user", content: "finished frieren" });
    await h.db
      .insert(diaryNotes)
      .values({ userId: user.id, animeId: 900001, text: "loved the ending" });

    const res = await h.app.inject({
      method: "GET",
      url: "/me/export",
      cookies: { [SESSION_COOKIE]: sessionCookie ?? "" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-disposition"]).toMatch(
      /^attachment; filename="kurisu-test_user-\d{4}-\d{2}-\d{2}\.json"$/,
    );
    const data = contract.dataExportSchema.parse(res.json());
    expect(data.account).toMatchObject({ malUsername: TEST_MAL_USER.name });
    expect(data.list).toHaveLength(fixtureList().length);
    expect(data.list).toContainEqual(
      expect.objectContaining({ title: "Fixture Watching Show", status: "watching" }),
    );
    expect(data.chats).toEqual([
      {
        title: "Frieren",
        createdAt: expect.any(String) as string,
        messages: [
          { role: "user", content: "finished frieren", createdAt: expect.any(String) as string },
        ],
      },
    ]);
    expect(data.diaryNotes).toContainEqual(
      expect.objectContaining({ title: "Fixture Watching Show", text: "loved the ending" }),
    );

    // No MAL token or session ever leaves, nor any field that holds one.
    const accessToken = await h.tokenStore.getValidAccessToken(user.id);
    for (const secret of [accessToken, sessionCookie ?? "no session"]) {
      expect(res.body).not.toContain(secret);
    }
    expect(res.body).not.toMatch(/accessToken|refreshToken|tokenHash|tokenEnc|codeHash|p256dh/i);
  });
});
