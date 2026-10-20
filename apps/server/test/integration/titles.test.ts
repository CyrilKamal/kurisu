import * as contract from "@kurisu/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { SESSION_COOKIE } from "../../src/auth/sessions.js";
import { airingEpisodes } from "../../src/db/schema.js";
import { fixtureList } from "../fixtures/animeList.js";
import { login, resetDatabase, startHarness, type Harness } from "../support/harness.js";
import { TEST_WEB_ORIGIN } from "../support/testConfig.js";

// MAL gives the Watching show an English title, "The Watching Show", and no Japanese one.
const WATCHING = 900001;
const FILM = 900002;

let h: Harness;
let session = "";

beforeAll(async () => {
  h = await startHarness();
});
afterAll(() => h.close());
beforeEach(async () => {
  await resetDatabase(h.db);
  h.fakeMal.reset();
  h.fakeMal.list = fixtureList();
  session = (await login(h)).sessionCookie ?? "";
});

function send(method: "GET" | "PUT" | "POST", url: string, payload?: object) {
  return h.app.inject({
    method,
    url,
    headers: { origin: TEST_WEB_ORIGIN },
    cookies: { [SESSION_COOKIE]: session },
    ...(payload === undefined ? {} : { payload }),
  });
}

async function choose(language: string) {
  return send("PUT", "/me/title-language", { language });
}

async function listTitles() {
  const list = contract.listResponseSchema.parse((await send("GET", "/list")).json());
  return new Map(list.entries.map((entry) => [entry.animeId, entry.title]));
}

describe("titles in the user's language", () => {
  it("shows English titles where MAL has one, on every screen but the data export", async () => {
    expect((await listTitles()).get(WATCHING)).toBe("Fixture Watching Show");

    const res = await choose("english");
    expect(contract.titleLanguageResponseSchema.parse(res.json())).toEqual({
      titleLanguage: "english",
    });
    const me = contract.meResponseSchema.parse((await send("GET", "/me")).json());
    expect(me.titleLanguage).toBe("english");

    const titles = await listTitles();
    expect(titles.get(WATCHING)).toBe("The Watching Show");
    // No English title on MAL: the romaji one stays.
    expect(titles.get(FILM)).toBe("Fixture Completed Film");

    const page = contract.showResponseSchema.parse(
      (await send("GET", `/shows/${String(WATCHING)}`)).json(),
    );
    expect(page.show.title).toBe("The Watching Show");
    expect(page.show.altTitles).toEqual(["Fixture Watching Show", "FWS"]);

    const exported = contract.dataExportSchema.parse((await send("GET", "/me/export")).json());
    expect(exported.list).toContainEqual(
      expect.objectContaining({ animeId: WATCHING, title: "Fixture Watching Show" }),
    );

    // MAL has no Japanese title for it, so Japanese shows the romaji one.
    await choose("japanese");
    expect((await listTitles()).get(WATCHING)).toBe("Fixture Watching Show");

    expect((await choose("klingon")).statusCode).toBe(400);
  });

  it("names calendar events in the user's language", async () => {
    await choose("english");
    await h.db
      .insert(airingEpisodes)
      .values({ malId: WATCHING, episode: 8, airingAt: new Date(Date.now() + 86_400_000) });
    const feed = contract.calendarResponseSchema.parse((await send("POST", "/calendar")).json());
    if (!feed.feed) throw new Error("no feed");
    const ics = await h.app.inject({
      method: "GET",
      url: feed.feed.url.replace(`${TEST_WEB_ORIGIN}/api`, ""),
    });
    expect(ics.body.replace(/\r\n /g, "")).toContain("SUMMARY:The Watching Show · Episode 8");
  });
});
