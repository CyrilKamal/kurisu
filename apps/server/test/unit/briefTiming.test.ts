import { describe, expect, it } from "vitest";

import { briefTiming, isValidTimeZone, localClock, minutesOf } from "../../src/brief/timing.js";

describe("localClock", () => {
  it("reads the date and time in the user's time zone", () => {
    const now = new Date("2026-10-06T03:30:00Z");
    expect(localClock(now, "UTC")).toEqual({ date: "2026-10-06", minutes: 3 * 60 + 30 });
    expect(localClock(now, "America/New_York")).toEqual({
      date: "2026-10-05",
      minutes: 23 * 60 + 30,
    });
    expect(localClock(now, "Asia/Tokyo")).toEqual({ date: "2026-10-06", minutes: 12 * 60 + 30 });
  });

  it("uses 00:xx, not 24:xx, just after midnight", () => {
    expect(localClock(new Date("2026-10-06T00:05:00Z"), "UTC")).toEqual({
      date: "2026-10-06",
      minutes: 5,
    });
  });
});

describe("briefTiming", () => {
  const settings = { localTime: "08:00", timeZone: "America/New_York" };

  it("is due once the brief time has passed on the user's clock", () => {
    expect(briefTiming(settings, new Date("2026-10-06T11:59:00Z"))).toEqual({ due: false }); // 07:59 EDT
    expect(briefTiming(settings, new Date("2026-10-06T12:03:00Z"))).toEqual({
      due: true,
      localDate: "2026-10-06",
      late: false,
      minutesLate: 3,
    });
  });

  it("is late more than four hours after the brief time", () => {
    expect(briefTiming(settings, new Date("2026-10-06T16:00:00Z"))).toMatchObject({ late: false }); // 12:00
    expect(briefTiming(settings, new Date("2026-10-06T16:05:00Z"))).toMatchObject({ late: true });
  });

  it("follows daylight saving time", () => {
    // 2026-11-01: New York falls back from EDT (UTC-4) to EST (UTC-5).
    expect(briefTiming(settings, new Date("2026-10-31T12:00:00Z"))).toMatchObject({
      due: true,
      minutesLate: 0,
    });
    expect(briefTiming(settings, new Date("2026-11-01T12:00:00Z"))).toEqual({ due: false });
    expect(briefTiming(settings, new Date("2026-11-01T13:00:00Z"))).toMatchObject({
      due: true,
      minutesLate: 0,
    });
  });

  it("still sends a brief whose time a spring-forward skipped", () => {
    // 2026-03-08: 02:00 to 03:00 doesn't exist in New York.
    const skipped = { localTime: "02:30", timeZone: "America/New_York" };
    expect(briefTiming(skipped, new Date("2026-03-08T07:00:00Z"))).toMatchObject({
      due: true,
      localDate: "2026-03-08",
      minutesLate: 30,
    });
  });
});

describe("helpers", () => {
  it("parses HH:MM and checks time zones", () => {
    expect(minutesOf("08:30")).toBe(510);
    expect(minutesOf("00:00")).toBe(0);
    expect(isValidTimeZone("Europe/Berlin")).toBe(true);
    expect(isValidTimeZone("Mars/Olympus_Mons")).toBe(false);
  });
});
