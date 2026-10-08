import type { ListEntry } from "@kurisu/shared";
import { describe, expect, it } from "vitest";

import { sourceLabel } from "../lib/describeChange";
import { canAddEpisode, editErrorMessage, editPayload, formFrom } from "../lib/editEntry";

function entry(fields: Partial<ListEntry> = {}): ListEntry {
  return {
    animeId: 1,
    title: "Show",
    pictureUrl: null,
    mediaType: "tv",
    numEpisodes: 12,
    airingStatus: "finished_airing",
    altTitles: [],
    genres: [],
    episodeMinutes: 24,
    malMean: null,
    status: "watching",
    score: 0,
    episodesWatched: 7,
    isRewatching: false,
    updatedAt: "2026-10-01T00:00:00.000Z",
    ...fields,
  };
}

describe("editPayload", () => {
  it("sends only the fields that changed", () => {
    const e = entry();
    expect(editPayload(e, formFrom(e))).toBeNull();
    expect(editPayload(e, { ...formFrom(e), episodesWatched: 9, score: 8 })).toEqual({
      episodesWatched: 9,
      score: 8,
    });
    expect(editPayload(e, { ...formFrom(e), status: "dropped" })).toEqual({ status: "dropped" });
  });
});

describe("canAddEpisode", () => {
  it("is for shows under way with episodes left", () => {
    expect(canAddEpisode(entry())).toBe(true);
    expect(canAddEpisode(entry({ status: "on_hold" }))).toBe(true);
    expect(canAddEpisode(entry({ numEpisodes: null }))).toBe(true);
    expect(canAddEpisode(entry({ episodesWatched: 12 }))).toBe(false);
    expect(canAddEpisode(entry({ status: "plan_to_watch", episodesWatched: 0 }))).toBe(false);
    expect(canAddEpisode(entry({ status: "completed", episodesWatched: 12 }))).toBe(false);
    expect(
      canAddEpisode(entry({ status: "completed", isRewatching: true, episodesWatched: 3 })),
    ).toBe(true);
  });
});

describe("messages and labels", () => {
  it("explains edit errors, falling back to the write errors", () => {
    expect(editErrorMessage("episodes_exceed_total")).toBe(
      "That's more episodes than the show has.",
    );
    expect(editErrorMessage("mal_unavailable")).toBe(
      "Couldn't reach MyAnimeList. Try again in a minute.",
    );
  });

  it("names who made a change, except the agent", () => {
    expect(sourceLabel("user")).toBe("Edited by you");
    expect(sourceLabel("import")).toBe("From import");
    expect(sourceLabel("undo")).toBe("Undo");
    expect(sourceLabel("agent")).toBeNull();
  });
});
