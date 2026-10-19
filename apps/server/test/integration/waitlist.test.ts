import { SESSION_COOKIE } from "../../src/auth/sessions.js";
import { invites, users, waitlist } from "../../src/db/schema.js";
import { WAITLIST_JOINS_PER_MINUTE } from "../../src/waitlist/routes.js";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { fixtureList } from "../fixtures/animeList.js";
import { login, resetDatabase, startHarness, type Harness } from "../support/harness.js";
import { TEST_WEB_ORIGIN } from "../support/testConfig.js";

let h: Harness;

beforeAll(async () => {
  h = await startHarness({ env: { CONTACT_EMAIL: "hello@kurisu.example" } });
});
afterAll(async () => {
  await h.close();
});
beforeEach(async () => {
  await resetDatabase(h.db);
  h.fakeMal.reset();
  h.fakeMal.list = fixtureList();
});

/** A visitor sending the landing page's form, after a human's few seconds on it. */
function join(payload: Record<string, unknown>, origin = TEST_WEB_ORIGIN) {
  return h.app.inject({
    method: "POST",
    url: "/waitlist",
    headers: { origin },
    payload: { elapsedMs: 4000, ...payload },
  });
}

async function owner(): Promise<string> {
  const result = await login(h);
  if (!result.sessionCookie) throw new Error("login failed");
  await h.db.update(users).set({ isOwner: true });
  return result.sessionCookie;
}

describe("the waitlist", () => {
  it("keeps one entry per email, and only the first join gets a leave link", async () => {
    const first = await join({ email: "  Sam@Example.com ", malUsername: "sam_k" });
    expect(first.statusCode).toBe(200);
    const joined = first.json<{ status: string; leaveToken: string | null }>();
    expect(joined.status).toBe("joined");
    expect(typeof joined.leaveToken).toBe("string");

    const again = await join({ email: "sam@example.com" });
    expect(again.json()).toEqual({ status: "already", leaveToken: null });

    const rows = await h.db.select().from(waitlist);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ email: "sam@example.com", malUsername: "sam_k" });
    // Only the token's hash is stored.
    expect(rows[0]?.leaveTokenHash).not.toBe(joined.leaveToken);
  });

  it("quietly keeps out bots: a filled hidden field, or a form sent at once", async () => {
    const honeypot = await join({ email: "bot1@example.com", website: "http://spam.example" });
    const instant = await join({ email: "bot2@example.com", elapsedMs: 200 });
    for (const res of [honeypot, instant]) {
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ status: "joined", leaveToken: null });
    }
    expect(await h.db.select().from(waitlist)).toEqual([]);
  });

  it("refuses bad input and other sites", async () => {
    expect((await join({ email: "not an email" })).statusCode).toBe(400);
    expect((await join({ email: "a@example.com", malUsername: "no spaces" })).statusCode).toBe(400);
    expect((await join({ email: "a@example.com" }, "https://evil.example")).statusCode).toBe(403);
    expect(await h.db.select().from(waitlist)).toEqual([]);
  });

  it("lets people leave with their link, and says nothing about other tokens", async () => {
    const joined = (await join({ email: "sam@example.com" })).json<{ leaveToken: string }>();
    const leave = (token: string) =>
      h.app.inject({
        method: "POST",
        url: "/waitlist/leave",
        headers: { origin: TEST_WEB_ORIGIN },
        payload: { token },
      });
    expect((await leave("x".repeat(32))).statusCode).toBe(204);
    expect(await h.db.select().from(waitlist)).toHaveLength(1);
    expect((await leave(joined.leaveToken)).statusCode).toBe(204);
    expect(await h.db.select().from(waitlist)).toEqual([]);
  });

  it("lets only the owner list entries and turn one into an invite", async () => {
    await join({ email: "sam@example.com" });
    const result = await login(h);
    if (!result.sessionCookie) throw new Error("login failed");
    const notOwner = await h.app.inject({
      method: "GET",
      url: "/waitlist",
      cookies: { [SESSION_COOKIE]: result.sessionCookie },
    });
    // Owner routes don't admit they exist.
    expect(notOwner.statusCode).toBe(404);

    const cookie = await owner();
    const listed = await h.app.inject({
      method: "GET",
      url: "/waitlist",
      cookies: { [SESSION_COOKIE]: cookie },
    });
    const [entry] = listed.json<{ entries: { id: string; invitedAt: string | null }[] }>().entries;
    expect(entry?.invitedAt).toBeNull();

    const invited = await h.app.inject({
      method: "POST",
      url: `/waitlist/${entry?.id ?? ""}/invite`,
      headers: { origin: TEST_WEB_ORIGIN },
      cookies: { [SESSION_COOKIE]: cookie },
    });
    expect(invited.statusCode).toBe(201);
    const { url } = invited.json<{ url: string }>();
    expect(url).toMatch(new RegExp(`^${TEST_WEB_ORIGIN}/invite/`));
    const [invite] = await h.db.select().from(invites);
    expect(invite?.note).toBe("sam@example.com");
    const [row] = await h.db.select().from(waitlist);
    expect(row?.inviteId).toBe(invite?.id);
    expect(row?.invitedAt).not.toBeNull();

    const code = url.split("/").pop() ?? "";
    const page = await h.app.inject({ method: "GET", url: `/invites/code/${code}` });
    expect(page.statusCode).toBe(200);
  });

  it("tells the public pages who runs kurisu and how to reach them", async () => {
    const site = await h.app.inject({ method: "GET", url: "/site" });
    expect(site.json()).toEqual({
      operator: null,
      contactEmail: "hello@kurisu.example",
      signup: "open",
    });
  });

  // Last: the limit is the whole server's, so the joins it uses up would spill into later tests
  // (and the earlier tests' joins count toward it too).
  it("stops a flood at the server-wide limit", async () => {
    const statuses: number[] = [];
    for (let i = 0; i <= WAITLIST_JOINS_PER_MINUTE; i++) {
      statuses.push((await join({ email: `p${String(i)}@example.com` })).statusCode);
    }
    expect(statuses).toContain(429);
    // Once refused, every later one in the minute is refused too.
    expect(statuses.slice(statuses.indexOf(429)).every((s) => s === 429)).toBe(true);
    expect((await h.db.select().from(waitlist)).length).toBeLessThanOrEqual(
      WAITLIST_JOINS_PER_MINUTE,
    );
  });
});
