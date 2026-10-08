import { describe, expect, it } from "vitest";

import {
  episodesWatched,
  finishedOn,
  finishedShow,
  summarizeActivity,
  type ActivityRow,
} from "../../src/stats/compute.js";
import { listEventsBetween, type EntrySnapshot } from "../../src/stats/events.js";

const at = (iso: string) => new Date(iso);

function entry(fields: Partial<EntrySnapshot> = {}): EntrySnapshot {
  return {
    status: "watching",
    episodesWatched: 3,
    score: 0,
    isRewatching: false,
    malUpdatedAt: at("2026-10-01T00:00:00Z"),
    ...fields,
  };
}

describe("listEventsBetween", () => {
  const sync = { startedAt: at("2026-10-08T12:00:00Z"), at: at("2026-10-08T12:00:05Z") };

  it("records shows added, the fields changed on others, and shows removed", () => {
    const mirror = new Map([
      [1, entry()],
      [2, entry({ status: "plan_to_watch", episodesWatched: 0 })],
      [3, entry({ status: "dropped" })],
    ]);
    const incoming = new Map([
      [1, entry({ episodesWatched: 5, score: 8, malUpdatedAt: at("2026-10-07T20:00:00Z") })],
      // Same values with a newer time (MAL touched it, e.g. a date): not an event.
      [
        2,
        entry({
          status: "plan_to_watch",
          episodesWatched: 0,
          malUpdatedAt: at("2026-10-07T00:00:00Z"),
        }),
      ],
      [
        4,
        entry({
          status: "completed",
          episodesWatched: 12,
          malUpdatedAt: at("2026-10-06T00:00:00Z"),
        }),
      ],
    ]);

    expect(listEventsBetween("u", mirror, incoming, sync)).toEqual([
      {
        userId: "u",
        animeId: 1,
        kind: "updated",
        before: { episodesWatched: 3, score: 0 },
        after: { episodesWatched: 5, score: 8 },
        at: at("2026-10-07T20:00:00Z"),
      },
      {
        userId: "u",
        animeId: 4,
        kind: "added",
        before: {},
        after: { status: "completed", episodesWatched: 12, score: 0, isRewatching: false },
        at: at("2026-10-06T00:00:00Z"),
      },
      {
        userId: "u",
        animeId: 3,
        kind: "removed",
        before: { status: "dropped", episodesWatched: 3, score: 0, isRewatching: false },
        after: {},
        at: sync.at,
      },
    ]);
  });

  it("ignores a copy older than the mirror, and a removal of an entry written during the sync", () => {
    // A kurisu write landed after the sync read MAL: the sync's copy is older.
    const mirror = new Map([
      [1, entry({ episodesWatched: 8, malUpdatedAt: at("2026-10-08T12:00:02Z") })],
      [2, entry({ malUpdatedAt: at("2026-10-08T12:00:03Z") })],
    ]);
    const incoming = new Map([
      [1, entry({ episodesWatched: 7, malUpdatedAt: at("2026-10-08T11:00:00Z") })],
    ]);
    expect(listEventsBetween("u", mirror, incoming, sync)).toEqual([]);
  });
});

function row(fields: Partial<ActivityRow>): ActivityRow {
  return {
    animeId: 1,
    title: "Frieren",
    episodeMinutes: 24,
    origin: "kurisu",
    kind: "updated",
    before: {},
    after: {},
    at: at("2026-10-07T00:00:00Z"),
    ...fields,
  };
}

describe("what activity counts", () => {
  it("counts episodes moved forward, and adds that say what was watched", () => {
    expect(
      episodesWatched(row({ before: { episodesWatched: 3 }, after: { episodesWatched: 5 } })),
    ).toBe(2);
    // Going back (a correction, or a rewatch starting over) counts as nothing.
    expect(
      episodesWatched(row({ before: { episodesWatched: 9 }, after: { episodesWatched: 1 } })),
    ).toBe(0);
    expect(episodesWatched(row({ before: { score: 7 }, after: { score: 8 } }))).toBe(0);
    // Added through kurisu: the user said they watched it.
    expect(
      episodesWatched(row({ kind: "added", after: { status: "completed", episodesWatched: 12 } })),
    ).toBe(12);
    // Added on MAL: counts while being watched; one logged as completed is usually an old show.
    const onMal = { kind: "added" as const, origin: "mal" as const };
    expect(
      episodesWatched(row({ ...onMal, after: { status: "watching", episodesWatched: 4 } })),
    ).toBe(4);
    expect(
      episodesWatched(row({ ...onMal, after: { status: "completed", episodesWatched: 12 } })),
    ).toBe(0);
  });

  it("counts a show as finished when it becomes completed", () => {
    expect(
      finishedShow(row({ before: { status: "watching" }, after: { status: "completed" } })),
    ).toBe(true);
    expect(
      finishedShow(row({ before: { status: "completed" }, after: { status: "completed" } })),
    ).toBe(false);
    expect(finishedShow(row({ kind: "added", after: { status: "completed" } }))).toBe(true);
    expect(
      finishedShow(row({ kind: "added", origin: "mal", after: { status: "completed" } })),
    ).toBe(false);
  });

  it("adds up episodes, minutes, shows and the shows finished", () => {
    const from = at("2026-10-01T00:00:00Z");
    const to = at("2026-10-08T00:00:00Z");
    const week = summarizeActivity(
      [
        row({ before: { episodesWatched: 10 }, after: { episodesWatched: 12 } }),
        row({
          before: { status: "watching", episodesWatched: 12 },
          after: { status: "completed", episodesWatched: 13 },
        }),
        row({
          animeId: 2,
          title: "Bocchi",
          episodeMinutes: null,
          origin: "mal",
          before: { episodesWatched: 0 },
          after: { episodesWatched: 2 },
        }),
      ],
      from,
      to,
    );
    expect(week).toEqual({
      from,
      to,
      episodes: 5,
      minutes: 3 * 24,
      shows: 2,
      finished: [{ animeId: 1, title: "Frieren" }],
    });
  });
});

describe("finishedOn", () => {
  it("uses MAL's finish date, or else the day it was seen completed in the user's time zone", () => {
    expect(finishedOn("2026-03-14", at("2026-10-01T00:00:00Z"), "UTC")).toBe("2026-03-14");
    expect(finishedOn("2026-03", null, "UTC")).toBe("2026-03");
    expect(finishedOn(null, at("2026-10-01T03:00:00Z"), "America/Los_Angeles")).toBe("2026-09-30");
    // An old show logged as completed, with neither: unknown.
    expect(finishedOn(null, null, "UTC")).toBeNull();
  });
});
