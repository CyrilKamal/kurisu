import { describe, expect, it } from "vitest";

import { diffParts } from "../lib/describeChange";
import {
  modelLabel,
  msLabel,
  runErrorLabel,
  secondsLabel,
  tokensLabel,
  toolsLabel,
} from "../lib/runMeta";

describe("RunMeta labels", () => {
  it("names Gemini models the short way, and others as they are", () => {
    expect(modelLabel("gemini:gemini-3.5-flash-lite")).toBe("Flash-Lite");
    expect(modelLabel("gemini:gemini-3.8-flash")).toBe("Flash");
    expect(modelLabel("gemini:gemini-3.8-flash-preview-09-2026")).toBe("Flash");
    expect(modelLabel("ollama:qwen3:8b")).toBe("qwen3:8b");
  });

  it("sets times, tokens and counts the way the log shows them", () => {
    expect(secondsLabel(2480)).toBe("2.5s");
    expect(secondsLabel(30_000)).toBe("30.0s");
    expect(msLabel(92)).toBe("92ms");
    expect(msLabel(1204)).toBe("1,204ms");
    expect(tokensLabel(1840)).toBe("1,840 tok");
    expect(toolsLabel(1)).toBe("1 tool");
    expect(toolsLabel(4)).toBe("4 tools");
  });

  it("puts error codes in words", () => {
    expect(runErrorLabel("model_timeout")).toBe("timed out");
    expect(runErrorLabel("something_odd")).toBe("something odd");
  });
});

describe("diffParts", () => {
  it("splits an update into old and new values, with the episode count", () => {
    expect(
      diffParts(
        "update",
        { episodesWatched: 6, status: "watching" },
        { episodesWatched: 12, status: "completed" },
        12,
      ),
    ).toEqual([
      { kind: "change", label: "ep", from: "6", to: "12", numeric: true },
      { kind: "of", total: 12 },
      { kind: "change", label: null, from: "Watching", to: "Completed", numeric: false },
    ]);
    expect(diffParts("update", { score: 0 }, { score: 9 })).toEqual([
      { kind: "change", label: "score", from: "–", to: "9", numeric: true },
    ]);
  });

  it("says adds and removals in words", () => {
    expect(diffParts("add", {}, { status: "plan_to_watch" })).toEqual([
      { kind: "text", text: "Added to Plan to Watch" },
    ]);
    expect(diffParts("remove", { status: "plan_to_watch" }, {})).toEqual([
      { kind: "text", text: "Removed from your list" },
    ]);
  });
});
