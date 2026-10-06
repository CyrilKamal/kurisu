import * as contract from "@kurisu/shared";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { SESSION_COOKIE } from "../../src/auth/sessions.js";
import { agentRuns, recommendations } from "../../src/db/schema.js";
import { parseModelRef } from "../../src/llm/modelConfig.js";
import { fixtureList } from "../fixtures/animeList.js";
import type { FakeListItem } from "../support/fakeMal.js";
import { login, resetDatabase, startHarness, type Harness } from "../support/harness.js";
import { lastToolResult, ScriptedModels, type ScriptStep } from "../support/scriptedModels.js";
import { TEST_WEB_ORIGIN } from "../support/testConfig.js";

const AGENT = parseModelRef("ollama:test-agent");
const RECOMMEND = parseModelRef("ollama:test-recommend");
const CHILL = 900021; // Plan to Watch: Slice of Life, Iyashikei, 24 min
const MOVIE = 900022; // Plan to Watch: a 120-minute drama movie
const WATCHING = 900001; // Watching, ep 7 of 12: Action, Fantasy, 24 min

let h: Harness;
let cookie: string;
const models = new ScriptedModels();

/** Two Plan to Watch shows on top of the fixture list. */
function list(): FakeListItem[] {
  const base = fixtureList();
  const template = base[0];
  if (!template) throw new Error("fixture changed");
  const extra = (
    id: number,
    title: string,
    media: string,
    genres: string[],
    minutes: number,
    episodes: number,
  ): FakeListItem => ({
    node: {
      ...structuredClone(template.node),
      id,
      title,
      media_type: media,
      num_episodes: episodes,
      genres: genres.map((name, i) => ({ id: i + 1, name })),
      average_episode_duration: minutes * 60,
      mean: 8.3,
      alternative_titles: { synonyms: [], en: "", ja: "" },
    },
    list_status: {
      ...structuredClone(template.list_status),
      status: "plan_to_watch",
      num_episodes_watched: 0,
    },
  });
  return [
    ...base,
    extra(CHILL, "Fixture Chill Show", "tv", ["Slice of Life", "Iyashikei"], 24, 12),
    extra(MOVIE, "Fixture Long Movie", "movie", ["Drama"], 120, 1),
  ];
}

beforeAll(async () => {
  h = await startHarness({
    models,
    roles: { agent: AGENT, escalation: null, recommend: RECOMMEND },
  });
});

afterAll(async () => {
  await h.close();
});

beforeEach(async () => {
  await resetDatabase(h.db);
  h.fakeMal.reset();
  h.fakeMal.list = list();
  models.reset();
  const result = await login(h);
  if (!result.sessionCookie) throw new Error("login failed");
  cookie = result.sessionCookie;
});

function send(text: string) {
  return h.app.inject({
    method: "POST",
    url: "/chat/messages",
    headers: { origin: TEST_WEB_ORIGIN },
    cookies: { [SESSION_COOKIE]: cookie },
    payload: { text },
  });
}

/** The progress agent hands the message to the recommender. */
const handOff: ScriptStep[] = [{ toolCalls: [{ name: "recommend_shows", arguments: {} }] }];

describe("recommendations in Chat", () => {
  it("hands a request to the recommender, which searches and shows picks as cards", async () => {
    let candidates: { anime_id: number; facts: string[] }[] = [];
    models.script(AGENT.ref, handOff);
    models.script(RECOMMEND.ref, [
      {
        toolCalls: [
          {
            name: "find_candidates",
            arguments: { available_minutes: 40, genres_any: ["Slice of Life", "Iyashikei"] },
          },
        ],
      },
      (req) => {
        candidates = lastToolResult(req).candidates as typeof candidates;
        return {
          toolCalls: [
            {
              name: "present_picks",
              arguments: {
                picks: [{ anime_id: CHILL, why: "Calm, short episodes you can finish tonight." }],
              },
            },
          ],
        };
      },
      { text: "Here's something chill." },
    ]);

    const res = await send("40 minutes, something chill");

    // The chill show, plus the fixture's paused and rewatching Slice of Life shows. Not the movie
    // (too long), the watching show (not Slice of Life), or anything completed or dropped.
    expect(candidates.map((c) => c.anime_id).sort()).toEqual([900003, 900006, CHILL].sort());
    expect(candidates.find((c) => c.anime_id === CHILL)?.facts).toContain("1 ep fits in your time");
    const thread = contract.chatThreadResponseSchema.parse(res.json());
    const reply = thread.messages.at(-1);
    expect(reply).toMatchObject({
      role: "assistant",
      content: "Here's something chill.",
      picks: [
        {
          animeId: CHILL,
          title: "Fixture Chill Show",
          status: "plan_to_watch",
          episodesWatched: 0,
          numEpisodes: 12,
          episodeMinutes: 24,
          why: "Calm, short episodes you can finish tonight.",
        },
      ],
    });

    // Logged as a recommendation run, linked to the run that handed it over.
    const runs = await h.db.select().from(agentRuns);
    const rec = runs.find((r) => r.promptVersion === "recommend@3");
    const progress = runs.find((r) => r.promptVersion !== "recommend@3");
    expect(rec).toMatchObject({ outcome: "recommended", handedOffFromRunId: progress?.id });
    const [row] = await h.db.select().from(recommendations);
    expect(row?.chatMessageId).toBe(reply?.id);
  });

  it("only shows picks the search returned", async () => {
    models.script(AGENT.ref, handOff);
    let feedback: Record<string, unknown> = {};
    models.script(RECOMMEND.ref, [
      { toolCalls: [{ name: "find_candidates", arguments: { media_types: ["movie"] } }] },
      {
        toolCalls: [
          {
            name: "present_picks",
            arguments: {
              picks: [
                { anime_id: 123456, why: "Made up." },
                { anime_id: WATCHING, why: "Not returned by this search." },
              ],
            },
          },
        ],
      },
      (req) => {
        feedback = lastToolResult(req);
        return { text: "Sorry." };
      },
    ]);

    const res = await send("a movie tonight?");

    expect(feedback.error).toBe("no_valid_picks");
    expect(contract.chatThreadResponseSchema.parse(res.json()).messages.at(-1)?.picks).toEqual([]);
    expect(await h.db.select().from(recommendations)).toEqual([]);
  });

  it("does the update first, then recommends, in one reply", async () => {
    models.script(AGENT.ref, [
      {
        toolCalls: [{ name: "search_my_list", arguments: { queries: ["fixture watching show"] } }],
      },
      {
        toolCalls: [
          { name: "propose_update", arguments: { anime_id: WATCHING, episodes_watched: 8 } },
        ],
      },
      (req) => ({
        toolCalls: [
          { name: "commit_update", arguments: { proposal_id: lastToolResult(req).proposal_id } },
          { name: "recommend_shows", arguments: {} },
        ],
      }),
    ]);
    models.script(RECOMMEND.ref, [
      { toolCalls: [{ name: "find_candidates", arguments: {} }] },
      {
        toolCalls: [
          {
            name: "present_picks",
            arguments: { picks: [{ anime_id: WATCHING, why: "Keep going." }] },
          },
        ],
      },
      { text: "Keep going with this one." },
    ]);

    const res = await send("watched ep 8 of fixture watching show, what next?");

    const reply = contract.chatThreadResponseSchema.parse(res.json()).messages.at(-1);
    expect(reply?.changes.map((c) => c.after)).toEqual([{ episodesWatched: 8 }]);
    expect(reply?.content).toBe("Done.\n\nKeep going with this one.");
    expect(reply?.picks.map((p) => [p.animeId, p.episodesWatched])).toEqual([[WATCHING, 8]]);
  });

  it("says it couldn't recommend when the recommender fails", async () => {
    models.script(AGENT.ref, handOff);
    models.script(RECOMMEND.ref, [{ throws: new Error("model down") }]);

    const res = await send("what should I watch?");

    const reply = contract.chatThreadResponseSchema.parse(res.json()).messages.at(-1);
    expect(reply?.picks).toEqual([]);
    expect(reply?.content.length).toBeGreaterThan(0);
    const [rec] = await h.db
      .select()
      .from(agentRuns)
      .where(eq(agentRuns.promptVersion, "recommend@3"));
    expect(rec?.outcome).toBe("error");
  });
});
