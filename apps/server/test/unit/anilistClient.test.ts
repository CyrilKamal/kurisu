import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  AniListApiError,
  AniListResponseError,
  createAniListClient,
  type AniListClient,
} from "../../src/anilist/client.js";
import { airingMedia, FakeAniList } from "../support/fakeAniList.js";
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

    const [media] = await client.mediaByMalIds([1]);

    expect(media).toEqual({
      anilistId: 101,
      malId: 1,
      status: "RELEASING",
      episodes: 12,
      nextEpisode: { episode: 8, airingAt: new Date("2026-10-06T15:00:00Z") },
      streamingLinks: [{ siteId: 5, site: "Crunchyroll", url: "https://cr.example/a" }],
    });
  });

  it("leaves out MAL ids AniList doesn't know, and keeps the first of duplicate entries", async () => {
    fake.media = [airingMedia(101, 1), airingMedia(102, 1), airingMedia(201, 2)];

    const media = await client.mediaByMalIds([1, 2, 3]);

    expect(media.map((m) => [m.malId, m.anilistId])).toEqual([
      [1, 101],
      [2, 201],
    ]);
  });

  it("asks for at most 50 ids per request and drops repeated ids", async () => {
    const ids = Array.from({ length: 120 }, (_, i) => i + 1);
    fake.media = ids.map((id) => airingMedia(1000 + id, id));

    const media = await client.mediaByMalIds([...ids, 1, 2, 3]);

    expect(media).toHaveLength(120);
    expect(fake.requests.map((r) => r.variables.ids?.length)).toEqual([50, 50, 20]);
  });

  it("sends no request for an empty list", async () => {
    expect(await client.mediaByMalIds([])).toEqual([]);
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

    expect(await client.mediaByMalIds([1])).toHaveLength(1);
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

  it("spaces requests apart", async () => {
    const spaced = createAniListClient({ apiUrl: fake.apiUrl, minIntervalMs: 40 });
    const ids = Array.from({ length: 101 }, (_, i) => i + 1); // three requests

    const started = Date.now();
    await spaced.mediaByMalIds(ids);

    expect(fake.requests).toHaveLength(3);
    expect(Date.now() - started).toBeGreaterThanOrEqual(75);
  });
});
