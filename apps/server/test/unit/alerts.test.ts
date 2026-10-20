import { describe, expect, it } from "vitest";

import {
  ALERT_LOOKBACK_MS,
  alertWindow,
  confirmedAired,
  episodesLabel,
  outNowLine,
} from "../../src/alerts/rules.js";
import { numberEpisodes } from "../../src/browse/load.js";

const HOUR_MS = 60 * 60 * 1000;
const now = new Date("2026-10-20T12:00:00Z");
const hoursAgo = (hours: number) => new Date(now.getTime() - hours * HOUR_MS);

describe("episode alerts", () => {
  it("look back a few hours, never before alerts were turned on", () => {
    expect(alertWindow(now, hoursAgo(48))).toEqual({
      from: new Date(now.getTime() - ALERT_LOOKBACK_MS),
      to: now,
    });
    expect(alertWindow(now, hoursAgo(1)).from).toEqual(hoursAgo(1));
  });

  it("go out only once AniList, asked after the episode's time, has moved past it", () => {
    const row = {
      anilistId: 501,
      status: "RELEASING",
      episodes: 12,
      nextEpisode: 9,
      fetchedAt: now,
    };
    expect(confirmedAired(row, 8, hoursAgo(1))).toBe(true);
    // Delayed: AniList still has it coming.
    expect(confirmedAired({ ...row, nextEpisode: 8 }, 8, hoursAgo(1))).toBe(false);
    // AniList's answer is from before the episode was due.
    expect(confirmedAired({ ...row, fetchedAt: hoursAgo(2) }, 8, hoursAgo(1))).toBe(false);
    // Finished, with that episode among its episodes.
    expect(confirmedAired({ ...row, nextEpisode: null, status: "FINISHED" }, 12, hoursAgo(1))).toBe(
      true,
    );
    expect(
      confirmedAired(
        { ...row, nextEpisode: null, status: "FINISHED", episodes: 10 },
        12,
        hoursAgo(1),
      ),
    ).toBe(false);
    // Airing with nothing scheduled, or unknown to AniList: can't tell.
    expect(confirmedAired({ ...row, nextEpisode: null }, 8, hoursAgo(1))).toBe(false);
    expect(confirmedAired({ ...row, anilistId: null }, 8, hoursAgo(1))).toBe(false);
    expect(confirmedAired(null, 8, hoursAgo(1))).toBe(false);
  });

  it("name one episode or a run of them, and where they stream", () => {
    expect(episodesLabel([8])).toBe("Episode 8");
    expect(episodesLabel([10, 8, 9])).toBe("Episodes 8–10");
    expect(outNowLine([])).toBe("Out now");
    expect(outNowLine([{ service: "Crunchyroll", url: null }])).toBe("Out now on Crunchyroll");
    expect(
      outNowLine([
        { service: "Crunchyroll", url: null },
        { service: "Netflix", url: null },
        { service: "Hulu", url: null },
      ]),
    ).toBe("Out now on Crunchyroll, Netflix and Hulu");
  });
});

describe("numbering episodes for the user's list", () => {
  const slot = (anilistId: number, malId: number, episode: number) => ({
    anilistId,
    malId,
    episode,
    airingAt: hoursAgo(1),
  });

  it("adds the part's offset, skips other parts, and lets recorded times fill in", () => {
    const parts = new Map([[1, { anilistId: 11, episodeOffset: 12 }]]);
    const numbered = numberEpisodes(
      [slot(11, 1, 3), slot(12, 1, 1), slot(20, 2, 5)],
      [
        { malId: 1, episode: 15, airingAt: hoursAgo(2) },
        { malId: 1, episode: 16, airingAt: hoursAgo(0) },
      ],
      (malId) => parts.get(malId),
    );
    expect(numbered.map((n) => [n.row.malId, n.episode, n.fromSlot])).toEqual([
      [1, 15, true], // AniList's episode 3 of the second part is MAL's 15
      [2, 5, true], // not on the list: AniList's number
      [1, 16, false],
    ]);
  });
});
