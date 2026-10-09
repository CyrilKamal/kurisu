import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  AniListApiError,
  AniListResponseError,
  createAniListClient,
  createAniListPacer,
  type AniListClient,
} from "../../src/anilist/client.js";
import { animeRowFromAniList } from "../../src/anilist/catalog.js";
import {
  airingMedia,
  catalogMedia,
  FakeAniList,
  relatedShow,
  streamingLink,
} from "../support/fakeAniList.js";
import { FakeHttpServer } from "../support/fakeHttp.js";

let fake: FakeAniList;
let client: AniListClient;

beforeAll(async () => {
  fake = await FakeAniList.start();
});

afterAll(async () => {
  await fake.stop();
});

beforeEach(() => {
  fake.reset();
  client = createAniListClient({
    apiUrl: fake.apiUrl,
    retry: { retries: 2, baseDelayMs: 1, maxDelayMs: 5 },
    minIntervalMs: 0,
  });
});

const seconds = (iso: string) => Date.parse(iso) / 1000;

describe("mediaByMalIds", () => {
  it("maps AniList entries and keeps only enabled streaming links", async () => {
    fake.media = [
      airingMedia(101, 1, {
        nextAiringEpisode: { episode: 8, airingAt: seconds("2026-10-06T15:00:00Z") },
        externalLinks: [
          {
            siteId: 5,
            site: "Crunchyroll",
            url: "https://cr.example/a",
            type: "STREAMING",
            isDisabled: false,
          },
          {
            siteId: 10,
            site: "Netflix",
            url: "https://nf.example/a",
            type: "STREAMING",
            isDisabled: true,
          },
          {
            siteId: 1,
            site: "Twitter",
            url: "https://x.example/a",
            type: "SOCIAL",
            isDisabled: false,
          },
          {
            siteId: 2,
            site: "Official Site",
            url: "https://a.example",
            type: "INFO",
            isDisabled: false,
          },
          {
            siteId: null,
            site: "Unknown",
            url: "https://u.example",
            type: "STREAMING",
            isDisabled: false,
          },
        ],
      }),
    ];

    const { media } = await client.mediaByMalIds([1]);

    expect(media).toEqual([
      {
        anilistId: 101,
        malId: 1,
        status: "RELEASING",
        episodes: 12,
        nextEpisode: { episode: 8, airingAt: new Date("2026-10-06T15:00:00Z") },
        streamingLinks: [{ siteId: 5, site: "Crunchyroll", url: "https://cr.example/a" }],
        episodeOffset: 0,
      },
    ]);
  });

  it("leaves out MAL ids AniList doesn't know", async () => {
    fake.media = [airingMedia(101, 1), airingMedia(201, 2)];

    const { media, unjoinable } = await client.mediaByMalIds([1, 2, 3]);

    expect(media.map((m) => [m.malId, m.anilistId])).toEqual([
      [1, 101],
      [2, 201],
    ]);
    expect(unjoinable).toEqual([]);
  });

  it("joins a show AniList splits into parts end to end, in MAL's episode numbers", async () => {
    // Steel Ball Run: MAL has one entry; AniList has a finished 1-episode "1st STAGE" and an
    // airing "2nd & 3rd STAGE" numbered from 1 again.
    fake.media = [
      airingMedia(210482, 61469, {
        format: "ONA",
        episodes: 11,
        startDate: { year: 2026, month: 9, day: 25 },
        nextAiringEpisode: { episode: 3, airingAt: seconds("2026-10-09T12:00:00Z") },
        externalLinks: [
          {
            siteId: 10,
            site: "Netflix",
            url: "https://nf.example/2",
            type: "STREAMING",
            isDisabled: false,
          },
        ],
      }),
      airingMedia(190327, 61469, {
        format: "ONA",
        status: "FINISHED",
        episodes: 1,
        startDate: { year: 2026, month: 3, day: 19 },
        externalLinks: [
          {
            siteId: 10,
            site: "Netflix",
            url: "https://nf.example/1",
            type: "STREAMING",
            isDisabled: false,
          },
          {
            siteId: 5,
            site: "Crunchyroll",
            url: "https://cr.example/1",
            type: "STREAMING",
            isDisabled: false,
          },
        ],
      }),
    ];

    // MAL's entry started with the 1st stage, so it covers both parts.
    const mal = new Map([[61469, { startDate: "2026-03-19", numEpisodes: null }]]);
    const { media } = await client.mediaByMalIds([61469], mal);

    expect(media).toEqual([
      {
        anilistId: 210482,
        malId: 61469,
        status: "RELEASING",
        episodes: 12,
        nextEpisode: { episode: 4, airingAt: new Date("2026-10-09T12:00:00Z") },
        streamingLinks: [
          { siteId: 10, site: "Netflix", url: "https://nf.example/2" },
          { siteId: 5, site: "Crunchyroll", url: "https://cr.example/1" },
        ],
        episodeOffset: 1,
      },
    ]);
  });

  it("lines the parts up with MAL's start date and total", async () => {
    fake.media = [
      airingMedia(210482, 61469, {
        format: "ONA",
        episodes: 11,
        startDate: { year: 2026, month: 9, day: 25 },
        nextAiringEpisode: { episode: 3, airingAt: seconds("2026-10-09T12:00:00Z") },
      }),
      airingMedia(190327, 61469, {
        format: "ONA",
        status: "FINISHED",
        episodes: 1,
        startDate: { year: 2026, month: 3, day: 19 },
      }),
    ];
    const lookup = async (startDate: string | null, numEpisodes: number | null = null) => {
      const { media } = await client.mediaByMalIds(
        [61469],
        new Map([[61469, { startDate, numEpisodes }]]),
      );
      return media[0]
        ? { offset: media[0].episodeOffset, next: media[0].nextEpisode?.episode }
        : null;
    };

    // MAL started with the 1st stage: both parts, numbered straight through.
    expect(await lookup("2026-03-19")).toEqual({ offset: 1, next: 4 });
    // A day off (time zones) still lines up.
    expect(await lookup("2026-03-20")).toEqual({ offset: 1, next: 4 });
    // The total adds up (1 + 11)...
    expect(await lookup("2026-03-19", 12)).toEqual({ offset: 1, next: 4 });
    // ...or doesn't.
    expect(await lookup("2026-03-19", 13)).toBeNull();
    // MAL's entry started with the 2nd stage: it's only that part, numbered as AniList does.
    expect(await lookup("2026-09-25")).toEqual({ offset: 0, next: 3 });
    // No part started then, MAL's date is partial, or MAL's date isn't known: skipped.
    expect(await lookup("2026-06-01")).toBeNull();
    expect(await lookup("2026-03")).toBeNull();
    expect(await lookup(null)).toBeNull();
    expect((await client.mediaByMalIds([61469])).unjoinable).toEqual([61469]);
  });

  it("won't join parts when the numbering would be a guess", async () => {
    const part = (id: number, overrides: Parameters<typeof airingMedia>[2]) =>
      airingMedia(id, id < 200 ? 1 : id < 300 ? 2 : id < 400 ? 3 : 4, overrides);
    fake.media = [
      // 1: an earlier part still airing.
      part(101, { startDate: { year: 2026, month: 1, day: 1 } }),
      part(102, { startDate: { year: 2026, month: 7, day: 1 } }),
      // 2: an earlier part with no episode count.
      part(201, {
        status: "FINISHED",
        episodes: null,
        startDate: { year: 2026, month: 1, day: 1 },
      }),
      part(202, { startDate: { year: 2026, month: 7, day: 1 } }),
      // 3: a movie or special mapped to the same MAL id.
      part(301, {
        format: "MOVIE",
        status: "FINISHED",
        episodes: 1,
        startDate: { year: 2026, month: 1, day: 1 },
      }),
      part(302, { startDate: { year: 2026, month: 7, day: 1 } }),
      // 4: two parts with no start date to order them by.
      part(401, { status: "FINISHED", startDate: null }),
      part(402, {}),
    ];

    // MAL says each started with its first part.
    const mal = new Map(
      [1, 2, 3, 4].map((id) => [
        id,
        { startDate: id === 4 ? "2026-07-01" : "2026-01-01", numEpisodes: null },
      ]),
    );
    const { media, unjoinable } = await client.mediaByMalIds([1, 2, 3, 4], mal);

    expect(media).toEqual([]);
    expect(unjoinable.sort()).toEqual([1, 2, 3, 4]);
  });

  it("asks for at most 50 ids per request and drops repeated ids", async () => {
    const ids = Array.from({ length: 120 }, (_, i) => i + 1);
    fake.media = ids.map((id) => airingMedia(1000 + id, id));

    const { media } = await client.mediaByMalIds([...ids, 1, 2, 3]);

    expect(media).toHaveLength(120);
    expect(fake.requests.map((r) => r.variables.ids?.length)).toEqual([50, 50, 20]);
  });

  it("sends no request for an empty list", async () => {
    expect(await client.mediaByMalIds([])).toEqual({ media: [], unjoinable: [] });
    expect(fake.requests).toHaveLength(0);
  });
});

describe("airedBetween", () => {
  it("returns episodes after `from` up to and including `to`", async () => {
    const from = new Date("2026-10-05T00:00:00Z");
    const to = new Date("2026-10-06T00:00:00Z");
    fake.airings = [
      { mediaId: 101, episode: 6, airingAt: seconds("2026-10-05T00:00:00Z") }, // at from: excluded
      { mediaId: 101, episode: 7, airingAt: seconds("2026-10-05T12:00:00Z") },
      { mediaId: 102, episode: 3, airingAt: seconds("2026-10-06T00:00:00Z") }, // at to: included
      { mediaId: 101, episode: 8, airingAt: seconds("2026-10-06T00:00:01Z") },
      { mediaId: 999, episode: 1, airingAt: seconds("2026-10-05T13:00:00Z") }, // another show
    ];

    const aired = await client.airedBetween([101, 102], from, to);

    expect(aired).toEqual([
      { anilistId: 101, episode: 7, airedAt: new Date("2026-10-05T12:00:00Z") },
      { anilistId: 102, episode: 3, airedAt: new Date("2026-10-06T00:00:00Z") },
    ]);
  });

  it("follows pages", async () => {
    const start = seconds("2026-10-05T00:00:00Z");
    fake.airings = Array.from({ length: 60 }, (_, i) => ({
      mediaId: 101,
      episode: i + 1,
      airingAt: start + 60 * (i + 1),
    }));

    const aired = await client.airedBetween(
      [101],
      new Date("2026-10-05T00:00:00Z"),
      new Date("2026-10-06T00:00:00Z"),
    );

    expect(aired).toHaveLength(60);
    expect(fake.requests.map((r) => r.variables.page)).toEqual([1, 2]);
  });
});

describe("errors and retries", () => {
  it("retries a rate limit and then succeeds", async () => {
    fake.media = [airingMedia(101, 1)];
    fake.failNext(429, 1, { "retry-after": "1" });

    expect((await client.mediaByMalIds([1])).media).toHaveLength(1);
    expect(fake.requests).toHaveLength(2);
  });

  it("gives up after its retries", async () => {
    fake.failNext(500, 3);

    await expect(client.mediaByMalIds([1])).rejects.toBeInstanceOf(AniListApiError);
    expect(fake.requests).toHaveLength(3);
  });

  it("doesn't retry a client error", async () => {
    fake.failNext(400);

    await expect(client.mediaByMalIds([1])).rejects.toBeInstanceOf(AniListApiError);
    expect(fake.requests).toHaveLength(1);
  });

  it("rejects GraphQL errors and unexpected shapes", async () => {
    const server = await FakeHttpServer.start();
    try {
      const scripted = createAniListClient({ apiUrl: server.baseUrl, minIntervalMs: 0 });
      server.reply(
        { body: { errors: [{ message: "Invalid query" }], data: null } },
        { body: { data: { Page: { pageInfo: {}, media: "nope" } } } },
      );
      await expect(scripted.mediaByMalIds([1])).rejects.toBeInstanceOf(AniListResponseError);
      await expect(scripted.mediaByMalIds([1])).rejects.toBeInstanceOf(AniListResponseError);
    } finally {
      await server.stop();
    }
  });

  it("spaces requests apart across clients that share a pacer, putting urgent ones first", async () => {
    const pacer = createAniListPacer(40);
    const background = createAniListClient({ apiUrl: fake.apiUrl, pacer });
    const chat = createAniListClient({ apiUrl: fake.apiUrl, pacer, urgent: true });
    const ids = Array.from({ length: 101 }, (_, i) => i + 1); // three requests

    const started = Date.now();
    const order: string[] = [];
    await Promise.all([
      background.mediaByMalIds(ids).then(() => order.push("background")),
      // Asked for after the background requests, but sent first.
      chat.mediaByMalIds([1]).then(() => order.push("chat")),
    ]);

    expect(fake.requests).toHaveLength(4);
    expect(order).toEqual(["chat", "background"]);
    expect(Date.now() - started).toBeGreaterThanOrEqual(115);
  });

  it("spaces requests apart", async () => {
    const spaced = createAniListClient({ apiUrl: fake.apiUrl, minIntervalMs: 40 });
    const ids = Array.from({ length: 101 }, (_, i) => i + 1); // three requests

    const started = Date.now();
    await spaced.mediaByMalIds(ids);

    expect(fake.requests).toHaveLength(3);
    expect(Date.now() - started).toBeGreaterThanOrEqual(75);
  });
});

describe("searchAnime", () => {
  it("searches every title in one request, leaving out adult titles and repeats", async () => {
    fake.catalog = [
      catalogMedia(201, 1001, "Sousou no Frieren", {
        title: {
          romaji: "Sousou no Frieren",
          english: "Frieren: Beyond Journey's End",
          native: "葬送のフリーレン",
        },
        synonyms: ["Frieren at the Funeral", "葬送的芙莉莲"],
        startDate: { year: 2027, month: 10, day: null },
      }),
      catalogMedia(202, null, "Frieren Mini Anime"),
      catalogMedia(203, 1003, "Frieren After Dark", { isAdult: true }),
    ];

    const shows = await client.searchAnime(["frieren", "sousou no frieren", "frieren"]);

    expect(fake.requests).toHaveLength(1);
    expect(fake.requests[0]?.variables).toEqual({ q0: "frieren", q1: "sousou no frieren" });
    expect(shows.map((s) => [s.anilistId, s.malId])).toEqual([
      [201, 1001],
      [202, null],
    ]);
    expect(shows[0]).toMatchObject({
      title: "Sousou no Frieren",
      titleEn: "Frieren: Beyond Journey's End",
      format: "TV",
      episodes: 12,
      duration: 24,
      startDate: "2027-10",
    });
  });

  it("sends no request without a title", async () => {
    expect(await client.searchAnime(["  "])).toEqual([]);
    expect(fake.requests).toHaveLength(0);
  });
});

describe("seasonLineup", () => {
  it("asks for each season's series, most popular first, in one request", async () => {
    fake.lineups.set("FALL 2026", [11, 12]);
    fake.lineups.set("SUMMER 2026 airing", [21]);

    const lineups = await client.seasonLineup([
      { season: "FALL", year: 2026 },
      { season: "SUMMER", year: 2026, airing: true },
    ]);

    expect(lineups).toEqual([[11, 12], [21]]);
    expect(fake.requests).toHaveLength(1);
    expect(fake.requests[0]?.query).toContain("isAdult: false");
    expect(fake.requests[0]?.query).toContain("format_in: [TV, TV_SHORT, ONA]");
  });
});

describe("sequelsOf", () => {
  it("keeps anime sequels with where they stream, once each, by the earlier show's MAL id", async () => {
    fake.relations.set(100, [
      relatedShow("SEQUEL", 2001, 200, "Show Season 2", {
        externalLinks: [
          streamingLink(5, "Crunchyroll", "https://cr.example/2001"),
          { ...streamingLink(10, "Netflix", "https://nf.example/2001"), isDisabled: true },
        ],
      }),
      relatedShow("PREQUEL", 2000, 99, "Show Zero"),
      relatedShow("SIDE_STORY", 2002, 201, "Show OVA"),
      relatedShow("SEQUEL", 2003, null, "Show Manga", { type: "MANGA" }),
      // A part of the same MAL entry (AniList splits it) isn't a sequel of it.
      relatedShow("SEQUEL", 2004, 100, "Show Part 2"),
    ]);
    fake.relations.set(300, []);

    const sequels = await client.sequelsOf([100, 300, 400]);

    expect([...sequels.keys()].sort()).toEqual([100, 300]);
    expect(sequels.get(300)).toEqual([]);
    expect(sequels.get(100)).toEqual([
      expect.objectContaining({
        anilistId: 2001,
        malId: 200,
        title: "Show Season 2",
        status: "RELEASING",
        isAdult: false,
        streamingLinks: [{ siteId: 5, site: "Crunchyroll", url: "https://cr.example/2001" }],
      }),
    ]);
  });
});

describe("animeRowFromAniList", () => {
  it("describes the show in MAL's words, keeping Latin-script synonyms", () => {
    expect(
      animeRowFromAniList({
        anilistId: 1,
        malId: 52991,
        title: "Sousou no Frieren",
        titleEn: "Frieren: Beyond Journey's End",
        titleJa: "葬送のフリーレン",
        synonyms: ["Frieren at the Funeral", "葬送的芙莉莲", " "],
        format: "MOVIE",
        status: "NOT_YET_RELEASED",
        episodes: 1,
        duration: 110,
        coverUrl: "http://insecure.example/x.jpg",
        startDate: "2027",
      }),
    ).toEqual({
      malId: 52991,
      title: "Sousou no Frieren",
      titleEn: "Frieren: Beyond Journey's End",
      titleJa: "葬送のフリーレン",
      synonyms: ["Frieren at the Funeral"],
      mainPictureUrl: null,
      mediaType: "movie",
      numEpisodes: 1,
      airingStatus: "not_yet_aired",
      startDate: "2027",
      episodeMinutes: 110,
    });
  });
});
