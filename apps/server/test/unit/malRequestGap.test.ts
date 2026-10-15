import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { malRequestJson, malRequestTurn, setMalRequestGap } from "../../src/mal/client.js";
import { FakeHttpServer } from "../support/fakeHttp.js";

let server: FakeHttpServer;

beforeAll(async () => {
  server = await FakeHttpServer.start();
});
afterAll(() => server.stop());
afterEach(() => {
  setMalRequestGap(0);
  server.reset();
});

const GAP = 60;
// Timers can fire a millisecond or two early.
const SLACK = 5;

describe("the gap between MAL requests", () => {
  it("spaces requests at least the gap apart, however many start at once", async () => {
    setMalRequestGap(GAP);
    const started = Date.now();
    const turns = await Promise.all(
      [0, 1, 2].map(async () => {
        await malRequestTurn();
        return Date.now() - started;
      }),
    );
    turns.sort((a, b) => a - b);
    expect(turns[0]).toBeLessThan(GAP);
    expect(turns[1]).toBeGreaterThanOrEqual(GAP - SLACK);
    expect(turns[2]).toBeGreaterThanOrEqual(2 * GAP - SLACK);
  });

  it("makes an API request wait its turn", async () => {
    setMalRequestGap(GAP);
    await malRequestTurn(); // another request just went out
    server.reply({ body: { ok: true } });
    const started = Date.now();
    const body = await malRequestJson(new URL(`${server.baseUrl}/v2/users/@me`), "token", {
      retries: 0,
      baseDelayMs: 1,
      maxDelayMs: 1,
    });
    expect(body).toEqual({ ok: true });
    expect(Date.now() - started).toBeGreaterThanOrEqual(GAP - SLACK);
  });

  it("doesn't wait at all with no gap set", async () => {
    const started = Date.now();
    await Promise.all([malRequestTurn(), malRequestTurn(), malRequestTurn()]);
    expect(Date.now() - started).toBeLessThan(GAP);
  });
});
