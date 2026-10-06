import { describe, expect, it } from "vitest";

import {
  buildBriefItems,
  chatText,
  episodesLabel,
  itemLine,
  parseBriefText,
  pushText,
  templateSummary,
  type BriefInput,
  type BriefItem,
} from "../../src/brief/build.js";

const at = (hour: number) => new Date(Date.UTC(2026, 9, 6, hour));
const crunchyroll = { siteId: 5, site: "Crunchyroll", url: "https://cr.example/x" };
const netflix = { siteId: 10, site: "Netflix", url: "https://nf.example/x" };
const primeOld = { siteId: 21, site: "Amazon Prime Video", url: "https://pv.example/x" };
const primeNew = { siteId: 261, site: "Prime Video", url: "https://pv.example/y" };

function input(overrides: Partial<BriefInput> = {}): BriefInput {
  return {
    watching: [
      { malId: 1, title: "Frieren", episodesWatched: 10, numEpisodes: 28 },
      { malId: 2, title: "Steel Ball Run", episodesWatched: 0, numEpisodes: 12 },
      { malId: 3, title: "Dandadan", episodesWatched: 4, numEpisodes: 6 },
    ],
    aired: [],
    links: new Map(),
    services: ["crunchyroll"],
    ...overrides,
  };
}

describe("buildBriefItems", () => {
  it("lists new episodes of Watching shows, in the order they aired", () => {
    const items = buildBriefItems(
      input({
        aired: [
          { malId: 3, episode: 6, airedAt: at(9) },
          { malId: 1, episode: 12, airedAt: at(5) },
          { malId: 3, episode: 5, airedAt: at(8) },
          { malId: 2, episode: 1, airedAt: at(7) },
        ],
      }),
    );

    expect(items.map((i) => [i.title, i.episodes])).toEqual([
      ["Frieren", [12]],
      ["Steel Ball Run", [1]],
      ["Dandadan", [5, 6]],
    ]);
    expect(items.map((i) => [i.premiere, i.finale])).toEqual([
      [false, false],
      [true, false],
      [false, true],
    ]);
  });

  it("leaves out episodes already watched, shows not on Watching, and repeats", () => {
    const items = buildBriefItems(
      input({
        aired: [
          { malId: 1, episode: 9, airedAt: at(1) },
          { malId: 1, episode: 10, airedAt: at(2) },
          { malId: 99, episode: 3, airedAt: at(3) },
          { malId: 3, episode: 5, airedAt: at(4) },
          { malId: 3, episode: 5, airedAt: at(4) },
        ],
      }),
    );

    expect(items.map((i) => [i.malId, i.episodes])).toEqual([[3, [5]]]);
  });

  it("names only the user's own services, by our labels", () => {
    const links = new Map([
      [1, [crunchyroll, netflix]],
      [2, [netflix]],
      [3, [primeOld, primeNew]],
    ]);
    const aired = [
      { malId: 1, episode: 11, airedAt: at(1) },
      { malId: 2, episode: 1, airedAt: at(2) },
      { malId: 3, episode: 5, airedAt: at(3) },
    ];

    const items = buildBriefItems(
      input({ aired, links, services: ["crunchyroll", "prime_video"] }),
    );

    expect(items.map((i) => i.services)).toEqual([["Crunchyroll"], [], ["Prime Video"]]);
    expect(
      buildBriefItems(input({ aired, links, services: [] })).every((i) => i.services.length === 0),
    ).toBe(true);
  });

  it("is empty when nothing new aired", () => {
    expect(buildBriefItems(input())).toEqual([]);
  });
});

describe("text", () => {
  const item = (overrides: Partial<BriefItem>): BriefItem => ({
    malId: 1,
    title: "Frieren",
    episodes: [12],
    premiere: false,
    finale: false,
    episodesWatched: 11,
    services: [],
    ...overrides,
  });

  it("labels episodes and ranges", () => {
    expect(episodesLabel([12])).toBe("ep 12");
    expect(episodesLabel([11, 12])).toBe("eps 11–12");
    expect(episodesLabel([1, 2, 3, 5, 7, 8])).toBe("eps 1–3, 5, 7–8");
  });

  it("writes one line per show, with where to watch and how far behind", () => {
    expect(itemLine(item({ services: ["Crunchyroll"] }))).toBe("- Frieren ep 12 on Crunchyroll");
    expect(itemLine(item({ episodesWatched: 9 }))).toBe("- Frieren ep 12. You're on ep 9.");
    expect(
      itemLine(item({ title: "SBR", episodes: [1], premiere: true, episodesWatched: 0 })),
    ).toBe("- SBR ep 1 (premiere)");
    expect(
      itemLine(
        item({ episodes: [5, 6], finale: true, episodesWatched: 4, services: ["Netflix", "Hulu"] }),
      ),
    ).toBe("- Frieren eps 5–6 (finale) on Netflix or Hulu");
  });

  it("puts the summary above the lines in chat", () => {
    expect(chatText("Two new ones.", [item({}), item({ title: "Dandadan", episodes: [5] })])).toBe(
      `Two new ones.\n\n- Frieren ep 12\n- Dandadan ep 5\n\nReply "watched it" once you've caught up on all of these.`,
    );
  });

  it("keeps the notification short", () => {
    expect(pushText([item({ services: ["Crunchyroll"] })])).toEqual({
      title: "Frieren ep 12",
      body: "On Crunchyroll. Tap to open the chat.",
    });
    expect(pushText([item({ title: "SBR", episodes: [1], premiere: true })]).title).toBe(
      "SBR ep 1 (premiere)",
    );

    const many = ["A", "B", "C", "D", "E", "F"].map((title, i) =>
      item({ title, episodes: i === 0 ? [3, 4] : [1], premiere: i === 1 }),
    );
    expect(pushText(many)).toEqual({
      title: "7 new episodes",
      body: "A 3–4 · B 1 (premiere) · C 1 · D 1 · +2 more",
    });
  });

  it("has a template summary for when the model's line can't be used", () => {
    expect(templateSummary([item({})])).toBe("Frieren has a new episode.");
    expect(templateSummary([item({ episodes: [11, 12] })])).toBe("Frieren has 2 new episodes.");
    expect(templateSummary([item({}), item({ title: "Dandadan", episodes: [5, 6] })])).toBe(
      "3 new episodes from 2 shows you're watching.",
    );
  });
});

describe("parseBriefText", () => {
  const item = (overrides: Partial<BriefItem>): BriefItem => ({
    malId: 1,
    title: "Frieren",
    episodes: [12],
    premiere: false,
    finale: false,
    episodesWatched: 11,
    services: [],
    ...overrides,
  });

  it("reads back each show and the episodes the brief listed", () => {
    const text = chatText("Lots today.", [
      item({ services: ["Crunchyroll"] }),
      item({ title: "Dandadan", episodes: [5, 6], finale: true, services: ["Netflix", "Hulu"] }),
      item({ title: "Kaiju No. 8: Part 2", episodes: [1, 2, 3, 5], episodesWatched: 0 }),
      item({ title: "SBR", episodes: [1], premiere: true, episodesWatched: 0 }),
      item({ title: "Behind", episodes: [9], episodesWatched: 3 }),
    ]);

    expect(parseBriefText(text)).toEqual([
      { title: "Frieren", episodes: [12] },
      { title: "Dandadan", episodes: [5, 6] },
      { title: "Kaiju No. 8: Part 2", episodes: [1, 2, 3, 5] },
      { title: "SBR", episodes: [1] },
      { title: "Behind", episodes: [9] },
    ]);
  });

  it("ignores text that isn't a brief", () => {
    expect(parseBriefText("- Frieren ep 12")).toEqual([]);
    expect(parseBriefText("Which season of Frieren do you mean?")).toEqual([]);
  });
});
