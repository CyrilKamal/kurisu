import * as contract from "@kurisu/shared";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { RECOMMEND_PROMPT } from "../../src/agent/prompts/index.js";
import { SESSION_COOKIE } from "../../src/auth/sessions.js";
import { agentRuns, anime, recommendations, users } from "../../src/db/schema.js";
import { parseModelRef } from "../../src/llm/modelConfig.js";
import { runRecommender } from "../../src/recommend/agent.js";
import {
  ensureSynopsisEmbeddings,
  listedSynopses,
  NEUTRAL_REQUESTS,
  type SemanticRanking,
} from "../../src/recommend/semantic.js";
import { fixtureList } from "../fixtures/animeList.js";
import { ConceptEmbedder } from "../support/conceptEmbedder.js";
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
                reply: "Here's something chill.",
              },
            },
          ],
        };
      },
    ]);

    const res = await send("40 minutes, something chill");
    // Showing picks with their sentence ends the run: two model calls, no third just to reply.
    expect(models.requests.filter((r) => r.ref === RECOMMEND.ref)).toHaveLength(2);

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
    const rec = runs.find((r) => r.promptVersion === "recommend@9");
    const progress = runs.find((r) => r.promptVersion !== "recommend@9");
    expect(rec).toMatchObject({ outcome: "recommended", handedOffFromRunId: progress?.id });
    const [row] = await h.db.select().from(recommendations);
    expect(row?.chatMessageId).toBe(reply?.id);
    // RunMeta names the recommender, and the trace runs on into its calls.
    expect(reply?.run).toMatchObject({
      model: AGENT.ref,
      handoff: { model: RECOMMEND.ref, promptVersion: "recommend@9" },
      // The progress run stopped to hand over; that's not an error.
      error: null,
    });
    expect(reply?.run?.steps.map((s) => s.tool)).toEqual([
      "recommend_shows",
      "find_candidates",
      "present_picks",
    ]);
    expect(reply?.run?.steps[0]?.result).toBe("handed to the recommender");
    expect(reply?.run?.steps[2]?.result).toBe("1 pick shown");
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
      .where(eq(agentRuns.promptVersion, "recommend@9"));
    expect(rec?.outcome).toBe("error");
  });
});

describe("the lab's semantic fit", () => {
  const SAD = "a drama about grief and saying goodbye";
  const embedder = new ConceptEmbedder({
    "anything that makes me cry": "tears",
    [SAD]: "tears",
  });

  /** One recommender run that searches with no constraints; returns the candidates' order. */
  async function candidatesFor(message: string, semantic?: SemanticRanking): Promise<number[]> {
    const [user] = await h.db.select({ id: users.id }).from(users);
    if (!user) throw new Error("no user");
    let order: number[] = [];
    models.script(RECOMMEND.ref, [
      { toolCalls: [{ name: "find_candidates", arguments: {} }] },
      (req) => {
        const found = lastToolResult(req).candidates as { anime_id: number }[];
        order = found.map((c) => c.anime_id);
        return {
          toolCalls: [
            {
              name: "present_picks",
              arguments: { picks: [{ anime_id: order[0], why: "Fits." }], reply: "Here." },
            },
          ],
        };
      },
    ]);
    await runRecommender(
      { db: h.db, models, prompt: RECOMMEND_PROMPT, ...(semantic && { semantic }) },
      {
        userId: user.id,
        conversationId: null,
        history: [],
        message,
        model: RECOMMEND,
        handedOffFromRunId: null,
      },
    );
    return order;
  }

  beforeEach(async () => {
    await h.db.update(anime).set({ synopsis: SAD }).where(eq(anime.malId, MOVIE));
    await h.db
      .update(anime)
      .set({ synopsis: "A calm countryside story." })
      .where(eq(anime.malId, CHILL));
    const [user] = await h.db.select({ id: users.id }).from(users);
    if (!user) throw new Error("no user");
    await ensureSynopsisEmbeddings({ db: h.db, embedder }, await listedSynopses(h.db, user.id));
  });

  it("ranks a show whose synopsis suits the request higher, by its weight", async () => {
    const plain = await candidatesFor("anything that makes me cry");
    expect(plain[0]).not.toBe(MOVIE);

    embedder.calls.length = 0;
    const fitted = await candidatesFor("anything that makes me cry", { embedder, weight: 1 });
    expect(fitted[0]).toBe(MOVIE);
    expect(embedder.calls).toEqual([
      { texts: ["anything that makes me cry", ...NEUTRAL_REQUESTS], purpose: "query" },
    ]);
    expect(await candidatesFor("anything that makes me cry", { embedder, weight: 0 })).toEqual(
      plain,
    );
  });

  it("ranks as before when the embedder fails", async () => {
    const plain = await candidatesFor("anything that makes me cry");
    const failures: unknown[] = [];
    const down: SemanticRanking = {
      embedder: {
        model: embedder.model,
        dimensions: embedder.dimensions,
        embed: () => Promise.reject(new Error("ollama is down")),
      },
      weight: 1,
      onError: (err) => failures.push(err),
    };
    expect(await candidatesFor("anything that makes me cry", down)).toEqual(plain);
    expect(failures).toHaveLength(1);
  });
});
