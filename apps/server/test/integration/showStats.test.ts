import * as contract from "@kurisu/shared";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { refreshCast, watchedIds } from "../../src/anilist/cast.js";
import { createAniListClient } from "../../src/anilist/client.js";
import { SESSION_COOKIE } from "../../src/auth/sessions.js";
import { showCast, showExtras, users } from "../../src/db/schema.js";
import { fixtureList } from "../fixtures/animeList.js";
import { airingMedia, FakeAniList } from "../support/fakeAniList.js";
import {
  backgroundSettled,
  login,
  resetDatabase,
  startHarness,
  type Harness,
} from "../support/harness.js";

const WATCHING = 900001; // ep 7 of 12
const COMPLETED = 900002; // a completed film
const PAUSED = 900003; // on hold, ep 10 of 24
const PLANNED = 900005; // plan to watch, nothing watched
const DAY_MS = 24 * 60 * 60 * 1000;

let h: Harness;
let anilist: FakeAniList;
let cookie = "";
let userId = "";

beforeAll(async () => {
  anilist = await FakeAniList.start();
  h = await startHarness({ env: { ANILIST_API_URL: anilist.apiUrl } });
});
afterAll(async () => {
  await h.close();
  await anilist.stop();
});
beforeEach(async () => {
  await resetDatabase(h.db);
  h.fakeMal.reset();
  anilist.reset();
  const list = fixtureList();
  const node = (id: number) => {
    const found = list.find((item) => item.node.id === id)?.node;
    if (!found) throw new Error("fixture changed");
    return found;
  };
  Object.assign(node(WATCHING), {
    studios: [{ id: 1, name: "Madhouse" }],
    broadcast: { day_of_the_week: "Saturday", start_time: "23:30" },
    start_date: "2026-09-01",
  });
  Object.assign(node(COMPLETED), {
    studios: [{ id: 1, name: "Madhouse" }],
    start_date: "1998-04-03",
  });
  Object.assign(node(PAUSED), { studios: [{ id: 2, name: "Bones" }], start_date: "2019-01-10" });
  h.fakeMal.list = list;
  cookie = (await login(h)).sessionCookie ?? "";
  await backgroundSettled(h);
  const [user] = await h.db.select({ id: users.id }).from(users);
  userId = user?.id ?? "";
});

function get(url: string) {
  return h.app.inject({ method: "GET", url, cookies: { [SESSION_COOKIE]: cookie } });
}

const voice = (id: number, name: string) => ({
  id,
  name: { full: name },
  image: { medium: `https://s4.anilist.co/staff/${String(id)}.png` },
});

describe("show pages", () => {
  it("add staff, AniList's score spread and MAL's broadcast slot", async () => {
    anilist.media = [airingMedia(5100, WATCHING, { description: "A journey." })];
    anilist.pages.set(WATCHING, {
      staff: {
        edges: [
          {
            role: "Director",
            node: { name: { full: "Keiichirou Saitou" }, image: { medium: null } },
          },
          { role: "Music", node: { name: { full: "Evan Call" }, image: { medium: null } } },
        ],
      },
      stats: {
        scoreDistribution: [
          { score: 100, amount: 60 },
          { score: 90, amount: 30 },
          { score: 50, amount: 10 },
        ],
      },
    });
    const page = contract.showResponseSchema.parse(
      (await get(`/shows/${String(WATCHING)}`)).json(),
    );
    expect(page.show.broadcast).toEqual({ day: "saturday", time: "23:30" });
    expect(page.extras?.staff).toEqual([
      { name: "Keiichirou Saitou", role: "Director", pictureUrl: null },
      { name: "Evan Call", role: "Music", pictureUrl: null },
    ]);
    const spread = page.extras?.scoreDistribution ?? [];
    expect(spread.map((c) => c.score)).toEqual([10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
    expect(spread.find((c) => c.score === 100)?.share).toBeCloseTo(0.6);
    expect(spread.find((c) => c.score === 10)?.share).toBe(0);
  });

  it("refetch extras stored before staff and the score spread, in the background", async () => {
    anilist.media = [airingMedia(5100, WATCHING, { description: "A journey." })];
    await get(`/shows/${String(WATCHING)}`);
    // As a page fetched before this change was stored it: no version, no staff.
    const [stored] = await h.db.select().from(showExtras).where(eq(showExtras.malId, WATCHING));
    if (!stored) throw new Error("no extras");
    const old = { ...stored.data };
    delete old.staff;
    delete old.scoreDistribution;
    delete old.version;
    await h.db.update(showExtras).set({ data: old }).where(eq(showExtras.malId, WATCHING));

    const asked = () =>
      anilist.requests.filter((r) => r.query.includes("streamingEpisodes")).length;
    const before = asked();
    const page = contract.showResponseSchema.parse(
      (await get(`/shows/${String(WATCHING)}`)).json(),
    );
    expect(page.extras?.staff).toEqual([]);
    expect(page.extras?.scoreDistribution).toBeNull();
    for (let i = 0; i < 50 && asked() === before; i++) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(asked()).toBe(before + 1);
  });
});

describe("Stats", () => {
  it("count studios, kinds, decades and main voices over the shows watched", async () => {
    // The login's background refresh looked them up before AniList had voices for them.
    await h.db.delete(showCast);
    anilist.casts.set(WATCHING, [voice(1, "Kana Ichinose"), voice(2, "Atsumi Tanezaki")]);
    anilist.casts.set(COMPLETED, [voice(1, "Kana Ichinose")]);
    const client = createAniListClient({ apiUrl: anilist.apiUrl, minIntervalMs: 0 });
    const ids = await watchedIds(h.db, userId);
    expect(ids).not.toContain(PLANNED);
    await refreshCast({ db: h.db, anilist: client }, ids);
    // One person voicing two main characters of a show still counts that show once.
    await h.db
      .update(showCast)
      .set({
        actors: [
          { id: 1, name: "Kana Ichinose", image: "https://s4.anilist.co/staff/1.png" },
          { id: 1, name: "Kana Ichinose", image: "https://s4.anilist.co/staff/1.png" },
          { id: 2, name: "Atsumi Tanezaki", image: null },
        ],
      })
      .where(eq(showCast.malId, WATCHING));

    const stats = contract.statsResponseSchema.parse((await get("/stats")).json());
    const watched = stats.allTime.watched;
    expect(watched.topStudios).toEqual([
      { studio: "Madhouse", shows: 2 },
      { studio: "Bones", shows: 1 },
    ]);
    expect(watched.formats).toContainEqual({ mediaType: "movie", shows: 1 });
    expect(watched.decades).toContainEqual({ decade: 1990, shows: 1 });
    expect(watched.decades).toContainEqual({ decade: 2010, shows: 1 });
    expect(watched.voiceActors[0]).toEqual({
      name: "Kana Ichinose",
      pictureUrl: "https://s4.anilist.co/staff/1.png",
      shows: 2,
    });
    // Every watched show has been looked up, the ones AniList doesn't know with nobody.
    expect(watched.castKnown).toBe(watched.shows);
  });

  it("looks a show's cast up again only after 90 days", async () => {
    const client = createAniListClient({ apiUrl: anilist.apiUrl, minIntervalMs: 0 });
    const deps = { db: h.db, anilist: client };
    await h.db.delete(showCast);
    expect(await refreshCast(deps, [WATCHING, COMPLETED])).toBe(2);
    expect(await refreshCast(deps, [WATCHING, COMPLETED])).toBe(0);
    await h.db
      .update(showCast)
      .set({ fetchedAt: new Date(Date.now() - 91 * DAY_MS) })
      .where(eq(showCast.malId, WATCHING));
    expect(await refreshCast(deps, [WATCHING, COMPLETED])).toBe(1);
  });
});
