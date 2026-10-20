import { describe, expect, it } from "vitest";

import type { MalAnimeNode } from "../../src/mal/client.js";
import { scoreSpread } from "../../src/shows/extras.js";
import { animeRowFrom } from "../../src/sync/mirrorRows.js";

describe("AniList's score spread", () => {
  it("is each score's share of AniList's users, 10 to 100", () => {
    const spread = scoreSpread([
      { score: 100, amount: 30 },
      { score: 80, amount: 10 },
    ]);
    expect(spread?.map((c) => c.score)).toEqual([10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
    expect(spread?.find((c) => c.score === 100)?.share).toBe(0.75);
    expect(spread?.reduce((sum, c) => sum + c.share, 0)).toBeCloseTo(1);
  });

  it("is left out when too few have scored it to say", () => {
    expect(scoreSpread([{ score: 100, amount: 19 }])).toBeNull();
    expect(scoreSpread([])).toBeNull();
  });
});

describe("MAL's studios and broadcast slot", () => {
  const node = (fields: Partial<MalAnimeNode>): MalAnimeNode => ({
    id: 1,
    title: "Show",
    ...fields,
  });

  it("keep the studios' names and a weekday and JST time", () => {
    expect(
      animeRowFrom(
        node({
          studios: [{ id: 1, name: " Madhouse " }],
          broadcast: { day_of_the_week: "Saturday", start_time: "1:05" },
        }),
        new Date(),
      ),
    ).toMatchObject({ studios: ["Madhouse"], broadcastDay: "saturday", broadcastTime: "01:05" });
  });

  it("leave out what MAL doesn't say plainly", () => {
    expect(
      animeRowFrom(node({ broadcast: { day_of_the_week: "other", start_time: null } }), new Date()),
    ).toMatchObject({ studios: [], broadcastDay: null, broadcastTime: null });
    expect(
      animeRowFrom(
        node({ broadcast: { day_of_the_week: "monday", start_time: "late" } }),
        new Date(),
      ),
    ).toMatchObject({ broadcastDay: "monday", broadcastTime: null });
  });
});
