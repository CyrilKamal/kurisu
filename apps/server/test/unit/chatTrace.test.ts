import { describe, expect, it } from "vitest";

import { stepArgs, stepResult } from "../../src/chat/trace.js";

const PROPOSAL = "7f3a91c2-0b1d-4e5f-8a9b-0c1d2e3f4a5b";

describe("stepArgs", () => {
  it("leads with the words searched for", () => {
    expect(stepArgs({ queries: ["tidewater"] })).toBe('"tidewater"');
    expect(stepArgs({ queries: ["jjk 2", "Jujutsu Kaisen 2nd Season"] })).toBe('"jjk 2" +1');
    expect(stepArgs({ query: "frieren" })).toBe('"frieren"');
  });

  it("names a show by id and a proposal by its short id", () => {
    expect(stepArgs({ anime_id: 5114, status: "completed", episodes_watched: 64 })).toBe(
      "#5114 status=completed episodes_watched=64",
    );
    expect(stepArgs({ proposal_id: PROPOSAL })).toBe("p_7f3a");
  });

  it("lists other settings, and leaves out what isn't a plain value", () => {
    expect(stepArgs({ airing_now: true, services: ["netflix", "hulu"], extra: { a: 1 } })).toBe(
      "airing_now=true services=netflix,hulu",
    );
    expect(stepArgs({})).toBe("");
    expect(stepArgs(null)).toBe("");
  });

  it("clips long arguments", () => {
    expect(stepArgs({ queries: ["x".repeat(200)] })).toHaveLength(80);
  });
});

describe("stepResult", () => {
  it("counts search results", () => {
    expect(stepResult({ results: [{}] }, null)).toEqual({ text: "1 match", ok: true });
    expect(stepResult({ results: [{}, {}] }, null)).toEqual({ text: "2 matches", ok: true });
    expect(stepResult({ results: [], note: "Not on the user's list." }, null)).toEqual({
      text: "no match",
      ok: true,
    });
    expect(stepResult({ candidates: [{}, {}, {}] }, null)).toEqual({
      text: "3 candidates",
      ok: true,
    });
  });

  it("says what happened to a write", () => {
    expect(stepResult({ proposal_id: PROPOSAL, requires_confirmation: false }, null).text).toBe(
      "p_7f3a",
    );
    expect(stepResult({ proposal_id: PROPOSAL, requires_confirmation: true }, null).text).toBe(
      "p_7f3a held",
    );
    expect(stepResult({ status: "committed" }, null).text).toBe("written");
    expect(stepResult({ status: "waiting_for_user_confirmation" }, null).text).toBe(
      "waits for your OK",
    );
    expect(stepResult({ status: "handed_off" }, null).text).toBe("handed to the recommender");
    expect(stepResult({ status: "shown", picks: 3 }, null).text).toBe("3 picks shown");
  });

  it("shows an error code as a failure", () => {
    expect(stepResult({ error: "not_found", message: "No such show." }, "not_found")).toEqual({
      text: "not_found",
      ok: false,
    });
    expect(stepResult({ error: "stale", message: "Changed." }, null)).toEqual({
      text: "stale",
      ok: false,
    });
  });

  it("falls back to ok", () => {
    expect(stepResult({ truncated: true, preview: "{" }, null)).toEqual({ text: "ok", ok: true });
    expect(stepResult({ title: "Monster", anime_id: 19 }, null)).toEqual({
      text: "Monster",
      ok: true,
    });
    expect(stepResult("anything", null)).toEqual({ text: "ok", ok: true });
  });
});
