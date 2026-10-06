import { describe, expect, it } from "vitest";
import { z } from "zod";

import { ReauthRequiredError } from "../../src/auth/tokenStore.js";
import {
  backoffDelay,
  DEFAULT_RETRY,
  MalApiError,
  MalResponseError,
  type MalAnimeListItem,
} from "../../src/mal/client.js";
import { MalOAuthError } from "../../src/mal/oauth.js";
import { classifySyncError } from "../../src/sync/listSync.js";
import { toMirrorRows } from "../../src/sync/mirrorRows.js";

function malItem(overrides: {
  node?: Partial<MalAnimeListItem["node"]>;
  list_status?: Partial<MalAnimeListItem["list_status"]>;
}): MalAnimeListItem {
  return {
    node: {
      id: 1,
      title: "Show",
      media_type: "tv",
      num_episodes: 12,
      status: "currently_airing",
      ...overrides.node,
    },
    list_status: {
      status: "watching",
      score: 0,
      num_episodes_watched: 3,
      is_rewatching: false,
      updated_at: "2026-09-01T12:00:00+09:00",
      ...overrides.list_status,
    },
  };
}

describe("toMirrorRows", () => {
  const syncedAt = new Date("2026-09-29T00:00:00Z");

  it("maps MAL's shape onto the mirror tables", () => {
    const { anime, entry } = toMirrorRows(
      malItem({
        node: {
          main_picture: {
            medium: "https://cdn.myanimelist.net/m.jpg",
            large: "https://cdn.myanimelist.net/l.jpg",
          },
          // When the show started airing, not when the user started it.
          start_date: "2026-07-03",
          genres: [
            { id: 36, name: "Slice of Life" },
            { id: 63, name: "Iyashikei" },
          ],
          average_episode_duration: 1430,
          mean: 8.21,
        },
        list_status: { start_date: "2026-09", score: 8 },
      }),
      "user-1",
      syncedAt,
    );

    expect(anime).toEqual({
      malId: 1,
      title: "Show",
      titleEn: null,
      titleJa: null,
      synonyms: [],
      mainPictureUrl: "https://cdn.myanimelist.net/m.jpg",
      mediaType: "tv",
      numEpisodes: 12,
      airingStatus: "currently_airing",
      startDate: "2026-07-03",
      genres: ["Slice of Life", "Iyashikei"],
      episodeMinutes: 24,
      malMean: 8.21,
      updatedAt: syncedAt,
    });
    expect(entry).toMatchObject({
      userId: "user-1",
      animeId: 1,
      status: "watching",
      score: 8,
      numEpisodesWatched: 3,
      startDate: "2026-09",
      finishDate: null,
      syncedAt,
    });
    // Timezone offsets are normalized.
    expect(entry.malUpdatedAt).toEqual(new Date("2026-09-01T03:00:00Z"));
  });

  it("keeps alternative titles, turning MAL's empty strings into null", () => {
    const { anime } = toMirrorRows(
      malItem({
        node: {
          alternative_titles: { en: " The Show ", ja: "", synonyms: ["TS", " ", "Show!"] },
        },
      }),
      "u",
      syncedAt,
    );

    expect(anime).toMatchObject({ titleEn: "The Show", titleJa: null, synonyms: ["TS", "Show!"] });
  });

  it("treats missing details, a 0-second duration and a 0 score as unknown", () => {
    const { anime } = toMirrorRows(
      malItem({ node: { average_episode_duration: 0, mean: 0 } }),
      "u",
      syncedAt,
    );
    expect(anime).toMatchObject({ genres: [], episodeMinutes: null, malMean: null });
    // A short (under a minute) still counts as one minute.
    expect(
      toMirrorRows(malItem({ node: { average_episode_duration: 20 } }), "u", syncedAt).anime
        .episodeMinutes,
    ).toBe(1);
  });

  it("treats MAL's 0 episodes as unknown", () => {
    expect(
      toMirrorRows(malItem({ node: { num_episodes: 0 } }), "u", syncedAt).anime.numEpisodes,
    ).toBeNull();
  });

  it("falls back to the large picture, and drops non-https picture URLs", () => {
    const large = toMirrorRows(
      malItem({ node: { main_picture: { large: "https://cdn.myanimelist.net/l.jpg" } } }),
      "u",
      syncedAt,
    );
    const insecure = toMirrorRows(
      malItem({ node: { main_picture: { medium: "javascript:alert(1)" } } }),
      "u",
      syncedAt,
    );

    expect(large.anime.mainPictureUrl).toBe("https://cdn.myanimelist.net/l.jpg");
    expect(insecure.anime.mainPictureUrl).toBeNull();
  });
});

describe("backoffDelay", () => {
  const retry = { ...DEFAULT_RETRY, baseDelayMs: 100, maxDelayMs: 1000 };

  it("grows exponentially with full jitter, capped", () => {
    expect(backoffDelay(0, retry, null, () => 0.999)).toBe(99);
    expect(backoffDelay(2, retry, null, () => 0.999)).toBe(399);
    expect(backoffDelay(10, retry, null, () => 0.999)).toBe(999);
    expect(backoffDelay(3, retry, null, () => 0)).toBe(0);
  });

  it("honors Retry-After seconds, within the cap", () => {
    expect(backoffDelay(0, retry, "0")).toBe(0);
    expect(backoffDelay(0, retry, "1")).toBe(1000);
    expect(backoffDelay(0, retry, "120")).toBe(1000);
  });

  it("ignores a Retry-After it can't parse", () => {
    expect(backoffDelay(1, retry, "Wed, 21 Oct 2026 07:28:00 GMT", () => 0.5)).toBe(100);
  });
});

describe("classifySyncError", () => {
  it("maps failures to stable codes", () => {
    expect(classifySyncError(new ReauthRequiredError())).toBe("reauth_required");
    expect(classifySyncError(new MalApiError(503, "/x"))).toBe("mal_unavailable");
    expect(classifySyncError(new MalOAuthError(500, "server_error"))).toBe("mal_unavailable");
    expect(classifySyncError(new TypeError("fetch failed"))).toBe("mal_unavailable");
    expect(classifySyncError(new DOMException("timed out", "TimeoutError"))).toBe(
      "mal_unavailable",
    );
    expect(classifySyncError(new MalResponseError("/x", "bad"))).toBe("invalid_response");
    expect(classifySyncError(z.string().safeParse(1).error)).toBe("invalid_response");
    expect(classifySyncError(new Error("boom"))).toBe("internal_error");
  });
});
