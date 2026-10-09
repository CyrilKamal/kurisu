import { describe, expect, it } from "vitest";

import { groupChats } from "../lib/chatGroups";

// Local times, so the test holds in any time zone.
const now = new Date(2026, 9, 6, 9, 30);
const chat = (id: string, at: Date) => ({
  id,
  title: id,
  lastMessageAt: at.toISOString(),
  isBrief: false,
});

describe("groupChats", () => {
  it("groups by the viewer's calendar day, keeping the order", () => {
    const chats = [
      chat("this-morning", new Date(2026, 9, 6, 0, 5)),
      chat("late-last-night", new Date(2026, 9, 5, 23, 55)),
      chat("yesterday-noon", new Date(2026, 9, 5, 12)),
      chat("last-week", new Date(2026, 8, 29, 12)),
      chat("long-ago", new Date(2026, 8, 28, 12)),
    ];

    expect(groupChats(chats, now).map((g) => [g.label, g.chats.map((c) => c.id)])).toEqual([
      ["Today", ["this-morning"]],
      ["Yesterday", ["late-last-night", "yesterday-noon"]],
      ["Previous 7 days", ["last-week"]],
      ["Older", ["long-ago"]],
    ]);
  });

  it("leaves out empty groups", () => {
    expect(groupChats([], now)).toEqual([]);
    expect(groupChats([chat("a", new Date(2026, 0, 1))], now).map((g) => g.label)).toEqual([
      "Older",
    ]);
  });
});
