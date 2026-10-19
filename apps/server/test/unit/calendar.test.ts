import { describe, expect, it } from "vitest";

import { episodeSummary, feedCalendar, type FeedEpisode } from "../../src/calendar/feed.js";
import { escapeText, foldLine, icsCalendar, icsDateTime } from "../../src/calendar/ics.js";

const now = new Date("2026-10-19T12:00:00Z");

const episode = (overrides: Partial<FeedEpisode> = {}): FeedEpisode => ({
  malId: 52991,
  title: "Sousou no Frieren",
  episode: 12,
  airingAt: new Date("2026-10-21T15:30:00Z"),
  episodeMinutes: 24,
  numEpisodes: 28,
  streamingLinks: [{ siteId: 5, site: "Crunchyroll", url: "https://www.crunchyroll.com/x" }],
  ...overrides,
});

describe("iCalendar text", () => {
  it("escapes what TEXT values can't hold", () => {
    expect(escapeText("Re:Zero; season 3, part 2\\done\nnext")).toBe(
      "Re:Zero\\; season 3\\, part 2\\\\done\\nnext",
    );
  });

  it("folds lines at 75 octets without splitting a character", () => {
    const folded = foldLine(`SUMMARY:${"あ".repeat(40)}`);
    const lines = folded.split("\r\n");
    expect(lines.length).toBeGreaterThan(1);
    for (const [i, line] of lines.entries()) {
      expect(Buffer.byteLength(line, "utf8")).toBeLessThanOrEqual(75);
      if (i > 0) expect(line.startsWith(" ")).toBe(true);
    }
    expect(lines.map((line, i) => (i === 0 ? line : line.slice(1))).join("")).toBe(
      `SUMMARY:${"あ".repeat(40)}`,
    );
    expect(foldLine("SHORT:line")).toBe("SHORT:line");
  });

  it("writes times in UTC", () => {
    expect(icsDateTime(new Date("2026-10-21T15:30:00.250Z"))).toBe("20261021T153000Z");
  });

  it("writes a calendar of transparent events, with CRLF line ends", () => {
    const ics = icsCalendar({
      name: "kurisu",
      description: "Episodes",
      refresh: "PT6H",
      events: [
        {
          uid: "1-2@kurisu",
          start: new Date("2026-10-21T15:30:00Z"),
          end: new Date("2026-10-21T15:54:00Z"),
          summary: "Show · Episode 2",
          url: "https://kurisu.example/shows/1",
        },
      ],
      now,
    });
    expect(ics.split("\r\n")).toEqual([
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//kurisu//calendar//EN",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
      "X-WR-CALNAME:kurisu",
      "X-WR-CALDESC:Episodes",
      "REFRESH-INTERVAL;VALUE=DURATION:PT6H",
      "X-PUBLISHED-TTL:PT6H",
      "BEGIN:VEVENT",
      "UID:1-2@kurisu",
      "DTSTAMP:20261019T120000Z",
      "DTSTART:20261021T153000Z",
      "DTEND:20261021T155400Z",
      "SUMMARY:Show · Episode 2",
      "URL:https://kurisu.example/shows/1",
      "TRANSP:TRANSPARENT",
      "END:VEVENT",
      "END:VCALENDAR",
      "",
    ]);
  });
});

describe("the feed's events", () => {
  it("names premieres and finales", () => {
    expect(episodeSummary(episode())).toBe("Sousou no Frieren · Episode 12");
    expect(episodeSummary(episode({ episode: 1 }))).toBe("Sousou no Frieren · Premiere");
    expect(episodeSummary(episode({ episode: 28 }))).toBe(
      "Sousou no Frieren · Episode 28 (finale)",
    );
    expect(episodeSummary(episode({ episode: 28, numEpisodes: null }))).toBe(
      "Sousou no Frieren · Episode 28",
    );
  });

  it("says where to watch only on the user's own services, never guessing", () => {
    const calendar = (services: string[]) =>
      feedCalendar({
        episodes: [episode()],
        services,
        webOrigin: "https://kurisu.example",
        included: true,
        now,
      }).replace(/\r\n /g, "");
    expect(calendar(["crunchyroll"])).toContain(
      "DESCRIPTION:On Crunchyroll.\\nIn kurisu: https://kurisu.example/shows/52991",
    );
    expect(calendar(["netflix"])).toContain(
      "DESCRIPTION:In kurisu: https://kurisu.example/shows/52991",
    );
  });

  it("lasts an episode's length, or 24 minutes when MAL doesn't know it", () => {
    const end = (minutes: number | null) =>
      /DTEND:(\S+)/.exec(
        feedCalendar({
          episodes: [episode({ episodeMinutes: minutes })],
          services: [],
          webOrigin: "https://kurisu.example",
          included: true,
          now,
        }),
      )?.[1];
    expect(end(12)).toBe("20261021T154200Z");
    expect(end(null)).toBe("20261021T155400Z");
  });

  it("stays a valid, empty calendar without Pro, and says why", () => {
    const ics = feedCalendar({
      episodes: [episode()],
      services: [],
      webOrigin: "https://kurisu.example",
      included: false,
      now,
    });
    expect(ics).not.toContain("BEGIN:VEVENT");
    expect(ics).toContain("X-WR-CALDESC:kurisu's calendar comes with Pro");
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
  });
});
