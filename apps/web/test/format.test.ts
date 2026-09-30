import type { LastSync } from "@kurisu/shared";
import { describe, expect, it } from "vitest";

import {
  countByStatus,
  lastSyncLabel,
  loginErrorMessage,
  mediaTypeLabel,
  progressLabel,
  relativeTime,
} from "../lib/format";

const now = new Date("2026-09-29T12:00:00Z");
const ago = (seconds: number) => new Date(now.getTime() - seconds * 1000).toISOString();

describe("progressLabel", () => {
  it("shows watched / total", () => {
    expect(progressLabel({ episodesWatched: 7, numEpisodes: 12 })).toBe("7 / 12 eps");
  });

  it("uses the singular for one-episode entries", () => {
    expect(progressLabel({ episodesWatched: 1, numEpisodes: 1 })).toBe("1 / 1 ep");
  });

  it("shows ? when MAL doesn't know the episode count", () => {
    expect(progressLabel({ episodesWatched: 3, numEpisodes: null })).toBe("3 / ? eps");
  });
});

describe("mediaTypeLabel", () => {
  it("maps MAL's codes to readable labels", () => {
    expect(mediaTypeLabel("tv")).toBe("TV");
    expect(mediaTypeLabel("movie")).toBe("Movie");
    expect(mediaTypeLabel("ona")).toBe("ONA");
  });

  it("hides unknown or missing types, and passes through new MAL values", () => {
    expect(mediaTypeLabel(null)).toBeNull();
    expect(mediaTypeLabel("unknown")).toBeNull();
    expect(mediaTypeLabel("new_format")).toBe("new_format");
  });
});

describe("countByStatus", () => {
  it("counts every status, including empty ones", () => {
    expect(
      countByStatus([{ status: "watching" }, { status: "watching" }, { status: "dropped" }]),
    ).toEqual({ watching: 2, completed: 0, on_hold: 0, dropped: 1, plan_to_watch: 0 });
  });
});

describe("relativeTime", () => {
  it("reads naturally at each scale", () => {
    expect(relativeTime(ago(10), now)).toBe("just now");
    expect(relativeTime(ago(5 * 60), now)).toBe("5 minutes ago");
    expect(relativeTime(ago(3 * 3600), now)).toBe("3 hours ago");
    expect(relativeTime(ago(26 * 3600), now)).toBe("yesterday");
    expect(relativeTime(ago(60 * 86400), now)).toBe("2 months ago");
  });
});

describe("lastSyncLabel", () => {
  const base: LastSync = {
    status: "succeeded",
    trigger: "manual",
    startedAt: ago(125),
    finishedAt: ago(120),
    entriesCount: 10,
    error: null,
  };

  it("describes each state", () => {
    expect(lastSyncLabel(null, now)).toBe("Not synced yet");
    expect(lastSyncLabel(base, now)).toBe("Synced 2 minutes ago");
    expect(lastSyncLabel({ ...base, status: "running", finishedAt: null }, now)).toBe("Syncing…");
    expect(lastSyncLabel({ ...base, status: "failed", error: "mal_unavailable" }, now)).toBe(
      "Last sync failed 2 minutes ago",
    );
  });
});

describe("loginErrorMessage", () => {
  it("explains known codes and falls back for unknown ones", () => {
    expect(loginErrorMessage(undefined)).toBeNull();
    expect(loginErrorMessage("access_denied")).toMatch(/declined/);
    expect(loginErrorMessage("invalid_state")).toMatch(/expired/);
    expect(loginErrorMessage("<script>")).toBe(loginErrorMessage("invalid_request"));
  });
});
