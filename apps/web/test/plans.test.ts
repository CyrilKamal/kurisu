import { PLAN_CATALOG, type PlanLimit, type PlanView } from "@kurisu/shared";
import { describe, expect, it } from "vitest";

import {
  googleCalendarUrl,
  limitText,
  nextPlanLine,
  planLimitOf,
  planShortLine,
  planSourceLine,
  priceLabel,
  supporterOf,
  trialDaysLeft,
  yearlySaving,
} from "../lib/plans";

const [free, premium, pro] = PLAN_CATALOG;

describe("plan prices", () => {
  it("shows a year's price with what it comes to a month, and a month's alone", () => {
    expect(priceLabel(premium, "year")).toEqual({
      price: "$24.99",
      per: "a year",
      note: "$2.08 a month",
    });
    expect(priceLabel(premium, "month")).toEqual({ price: "$2.99", per: "a month", note: null });
    expect(priceLabel(pro, "year")).toEqual({
      price: "$49.99",
      per: "a year",
      note: "$4.16 a month",
    });
    expect(priceLabel(free, "year")).toEqual({ price: "$0", per: "forever", note: null });
  });

  it("says how much a year saves", () => {
    expect(yearlySaving(premium)).toBe(30);
    expect(yearlySaving(pro)).toBe(30);
    expect(yearlySaving(free)).toBe(0);
  });
});

const limit = (overrides: Partial<PlanLimit>): PlanLimit => ({
  kind: "chat",
  plan: "free",
  allowance: 30,
  used: 30,
  resetsAt: "2026-11-01T00:00:00.000Z",
  ...overrides,
});

describe("plan limits", () => {
  it("reads a plan_limit out of a failed request's body, and nothing else", () => {
    const chat = limit({});
    expect(planLimitOf({ error: "plan_limit", limit: chat })).toEqual(chat);
    expect(planLimitOf({ error: "daily_limit" })).toBeNull();
    expect(planLimitOf(undefined)).toBeNull();
  });

  it("says what ran out, on which plan, and when it comes back", () => {
    expect(limitText(limit({}))).toBe(
      "You've used this month's 30 chat updates on Free. They come back on the 1st.",
    );
    expect(limitText(limit({ kind: "recommendations", plan: "premium", allowance: 300 }))).toBe(
      "You've used this month's 300 recommendations on Premium. They come back on the 1st.",
    );
    expect(limitText(limit({ kind: "imports", allowance: 1, used: 1 }))).toBe(
      "You've used this month's import on Free. It comes back on the 1st.",
    );
    expect(limitText(limit({ kind: "import_lines", allowance: 500, used: 1200 }))).toBe(
      "These notes have 1,200 lines, and an import on Free takes up to 500. Import part of them now, or split them.",
    );
  });

  it("names what the next plan up gives, and nothing on the top plan", () => {
    expect(nextPlanLine(limit({}))).toBe("Premium has 1,000 a month.");
    expect(nextPlanLine(limit({ kind: "recommendations", plan: "premium" }))).toBe(
      "Pro has 1,000 a month.",
    );
    expect(nextPlanLine(limit({ kind: "import_lines" }))).toBe(
      "Premium imports whenever you like, with no limit on lines.",
    );
    expect(nextPlanLine(limit({ plan: "pro" }))).toBeNull();
  });
});

const PREMIUM = {
  supporterBadge: true,
  episodeAlerts: true,
  calendar: false,
  fullYear: false,
  lab: false,
};
const PRO = {
  supporterBadge: true,
  episodeAlerts: true,
  calendar: true,
  fullYear: true,
  lab: true,
};

describe("plan lines", () => {
  const now = new Date("2026-10-19T12:00:00Z");
  const trial: PlanView = {
    id: "premium",
    source: "trial",
    until: "2026-10-28T09:00:00.000Z",
    cancelAtPeriodEnd: false,
    features: PREMIUM,
  };

  it("counts a trial's days left, with today's part as one", () => {
    expect(trialDaysLeft(trial, now)).toBe(9);
    expect(trialDaysLeft({ ...trial, until: "2026-10-19T13:00:00.000Z" }, now)).toBe(1);
    expect(trialDaysLeft({ ...trial, source: "free", id: "free", until: null }, now)).toBeNull();
  });

  it("says why someone is on their plan, and until when", () => {
    expect(planSourceLine(trial, now)).toBe(
      "Premium trial, 9 days left. Then Free, unless you subscribe.",
    );
    expect(planShortLine(trial, now)).toBe("Premium trial · 9 days left");
    const renewing: PlanView = {
      id: "pro",
      source: "subscription",
      until: "2027-10-19T00:00:00.000Z",
      cancelAtPeriodEnd: false,
      features: PRO,
    };
    expect(planSourceLine(renewing, now)).toBe("Pro, renewing 2027-10-19.");
    expect(planShortLine({ ...renewing, cancelAtPeriodEnd: true }, now)).toBe(
      "Pro · ends 2027-10-19",
    );
    expect(planSourceLine({ ...renewing, cancelAtPeriodEnd: true }, now)).toBe(
      "Pro until 2027-10-19; it won't renew.",
    );
    const owner: PlanView = {
      id: "pro",
      source: "owner",
      until: null,
      cancelAtPeriodEnd: false,
      features: PRO,
    };
    expect(planShortLine(owner)).toBe("Pro · kurisu's owner");
  });

  it("gives a supporter badge for a paid plan only, never a trial or the owner", () => {
    const paid: PlanView = { ...trial, source: "subscription" };
    expect(supporterOf(paid)).toBe("premium");
    expect(supporterOf(trial)).toBeNull();
    expect(supporterOf({ ...paid, id: "pro", source: "owner", features: PRO })).toBeNull();
    expect(supporterOf({ ...paid, features: { ...PREMIUM, supporterBadge: false } })).toBeNull();
  });
});

describe("calendar links", () => {
  it("opens Google Calendar's add-by-URL page for the feed", () => {
    expect(googleCalendarUrl("webcal://kurisu.example/api/calendar/feed/abc.ics")).toBe(
      "https://calendar.google.com/calendar/render?cid=webcal%3A%2F%2Fkurisu.example%2Fapi%2Fcalendar%2Ffeed%2Fabc.ics",
    );
  });
});
