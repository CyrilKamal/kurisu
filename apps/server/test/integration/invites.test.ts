import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { SESSION_COOKIE } from "../../src/auth/sessions.js";
import { invites, listEntries, sessions, users } from "../../src/db/schema.js";
import { fixtureList } from "../fixtures/animeList.js";
import {
  login,
  resetDatabase,
  startHarness,
  TEST_MAL_USER,
  type Harness,
} from "../support/harness.js";
import { TEST_WEB_ORIGIN } from "../support/testConfig.js";

// TEST_MAL_USER owns this kurisu; friends are other MAL accounts the fake MAL logs in as.
const ALEX = { id: 5151, name: "alex" };
const SAM = { id: 6262, name: "sam" };

let h: Harness;

beforeAll(async () => {
  h = await startHarness({ env: { OWNER_MAL_USERNAME: TEST_MAL_USER.name } });
});
afterAll(() => h.close());
beforeEach(async () => {
  await resetDatabase(h.db);
  h.fakeMal.reset();
  h.fakeMal.list = fixtureList();
});

async function loginAs(user: { id: number; name: string }, invite?: string) {
  h.fakeMal.user = user;
  return login(h, undefined, invite);
}

async function ownerCookie(): Promise<string> {
  const { sessionCookie } = await loginAs(TEST_MAL_USER);
  if (!sessionCookie) throw new Error("the owner couldn't log in");
  return sessionCookie;
}

function send(method: "GET" | "POST" | "DELETE", url: string, cookie: string, payload?: object) {
  return h.app.inject({
    method,
    url,
    headers: { origin: TEST_WEB_ORIGIN },
    cookies: { [SESSION_COOKIE]: cookie },
    ...(payload === undefined ? {} : { payload }),
  });
}

/** The owner makes an invite; returns its code, as the link carries it. */
async function invite(cookie: string, note?: string): Promise<string> {
  const res = await send("POST", "/invites", cookie, note === undefined ? {} : { note });
  expect(res.statusCode).toBe(201);
  const { url } = res.json<{ url: string }>();
  expect(url.startsWith(`${TEST_WEB_ORIGIN}/invite/`)).toBe(true);
  return url.slice(`${TEST_WEB_ORIGIN}/invite/`.length);
}

async function accountFor(malUserId: number) {
  const [row] = await h.db.select().from(users).where(eq(users.malUserId, malUserId));
  return row;
}

describe("invites", () => {
  it("lets a friend join with the owner's link, once", async () => {
    const owner = await ownerCookie();
    const code = await invite(owner, "Alex");

    const check = await h.app.inject({ method: "GET", url: `/invites/code/${code}` });
    expect(check.statusCode).toBe(200);
    expect(check.json()).toEqual({ inviter: TEST_MAL_USER.name });

    const joined = await loginAs(ALEX, code);
    expect(joined.callbackResponse.headers.location).toBe("/list");
    expect(joined.sessionCookie).toBeDefined();
    expect(await accountFor(ALEX.id)).toMatchObject({ malUsername: "alex", isOwner: false });
    expect(await accountFor(TEST_MAL_USER.id)).toMatchObject({ isOwner: true });

    const listed = await send("GET", "/invites", owner);
    expect(listed.json()).toMatchObject({
      invites: [{ note: "Alex", status: "used", usedBy: "alex" }],
    });

    // Used up: the page says so, and nobody else gets in with it.
    expect((await h.app.inject({ method: "GET", url: `/invites/code/${code}` })).statusCode).toBe(
      404,
    );
    const second = await loginAs(SAM, code);
    expect(second.callbackResponse.headers.location).toBe("/?login_error=invite_only");
    expect(await accountFor(SAM.id)).toBeUndefined();
  });

  it("lets a friend who already joined log in again without an invite", async () => {
    const owner = await ownerCookie();
    await loginAs(ALEX, await invite(owner));

    const again = await loginAs(ALEX);
    expect(again.callbackResponse.headers.location).toBe("/list");
  });

  it("turns away an expired invite", async () => {
    const owner = await ownerCookie();
    const code = await invite(owner);
    await h.db.update(invites).set({ expiresAt: new Date(Date.now() - 1000) });

    const res = await loginAs(ALEX, code);
    expect(res.callbackResponse.headers.location).toBe("/?login_error=invite_only");
    expect(await accountFor(ALEX.id)).toBeUndefined();
  });

  it("leaves no account when the invite is revoked while the friend is on MAL", async () => {
    const owner = await ownerCookie();
    const code = await invite(owner);
    const [row] = await h.db.select({ id: invites.id }).from(invites);
    if (!row) throw new Error("no invite");

    h.fakeMal.user = ALEX;
    const res = await login(
      h,
      async () => {
        const revoked = await send("DELETE", `/invites/${row.id}`, owner);
        expect(revoked.statusCode).toBe(204);
      },
      code,
    );
    expect(res.callbackResponse.headers.location).toBe("/?login_error=invite_only");
    expect(await accountFor(ALEX.id)).toBeUndefined();
  });

  it("keeps invites to the owner", async () => {
    const owner = await ownerCookie();
    const { sessionCookie: alex } = await loginAs(ALEX, await invite(owner));
    if (!alex) throw new Error("alex couldn't join");

    expect((await send("GET", "/invites", alex)).statusCode).toBe(404);
    expect((await send("POST", "/invites", alex, {})).statusCode).toBe(404);
    const me = await send("GET", "/me", alex);
    expect(me.json()).toMatchObject({ user: { malUsername: "alex", isOwner: false } });
  });

  it("doesn't let a used invite be revoked", async () => {
    const owner = await ownerCookie();
    await loginAs(ALEX, await invite(owner));
    const [row] = await h.db.select({ id: invites.id }).from(invites);
    if (!row) throw new Error("no invite");

    expect((await send("DELETE", `/invites/${row.id}`, owner)).statusCode).toBe(404);
  });
});

describe("DELETE /me", () => {
  it("deletes everything kurisu holds for the account, and nothing on MAL", async () => {
    const owner = await ownerCookie();
    const { sessionCookie: alex } = await loginAs(ALEX, await invite(owner));
    if (!alex) throw new Error("alex couldn't join");
    const account = await accountFor(ALEX.id);
    if (!account) throw new Error("no account");
    expect(
      await h.db.select().from(listEntries).where(eq(listEntries.userId, account.id)),
    ).not.toEqual([]);

    const res = await send("DELETE", "/me", alex);

    expect(res.statusCode).toBe(204);
    expect(res.cookies.find((c) => c.name === SESSION_COOKIE)?.value).toBe("");
    expect(await accountFor(ALEX.id)).toBeUndefined();
    expect(await h.db.select().from(listEntries).where(eq(listEntries.userId, account.id))).toEqual(
      [],
    );
    expect(await h.db.select().from(sessions).where(eq(sessions.userId, account.id))).toEqual([]);
    // The owner's invite stays, no longer pointing at anyone.
    expect(await h.db.select({ usedBy: invites.usedBy }).from(invites)).toEqual([{ usedBy: null }]);
    expect(h.fakeMal.patchRequests).toEqual([]);
    expect(h.fakeMal.deleteRequests).toEqual([]);
    // The owner is untouched.
    expect((await send("GET", "/me", owner)).statusCode).toBe(200);
  });
});
