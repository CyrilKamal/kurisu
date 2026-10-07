import * as contract from "@kurisu/shared";
import { asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { PROGRESS_SYNC_V1 } from "../../src/agent/prompts/progressSync.v1.js";
import { runAgent } from "../../src/agent/runAgent.js";
import { SESSION_COOKIE } from "../../src/auth/sessions.js";
import {
  agentRuns,
  agentRunSteps,
  anilistMedia,
  anime,
  chatMessages,
  conversations,
  listEntries,
  proposals,
  users,
} from "../../src/db/schema.js";
import { parseModelRef } from "../../src/llm/modelConfig.js";
import { ModelProviderError, type ChatRequest } from "../../src/llm/types.js";
import { createMalListWriter } from "../../src/writes/commit.js";
import { fixtureList } from "../fixtures/animeList.js";
import { login, resetDatabase, startHarness, type Harness } from "../support/harness.js";
import { lastToolResult, ScriptedModels, type ScriptStep } from "../support/scriptedModels.js";
import { TEST_WEB_ORIGIN } from "../support/testConfig.js";

const LITE = parseModelRef("ollama:test-lite");
const FLASH = parseModelRef("ollama:test-flash");
const WATCHING = 900001; // Fixture Watching Show: watching, 7 / 12

const models = new ScriptedModels();
let h: Harness;
let userId: string;
let cookie: string;

beforeAll(async () => {
  h = await startHarness({ models, roles: { agent: LITE, escalation: FLASH } });
});

afterAll(async () => {
  await h.close();
});

beforeEach(async () => {
  await resetDatabase(h.db);
  h.fakeMal.reset();
  h.fakeMal.list = fixtureList();
  models.reset();
  const result = await login(h);
  cookie = result.sessionCookie ?? "";
  const [user] = await h.db.select().from(users);
  if (!user) throw new Error("no user");
  userId = user.id;
});

/** search → propose → commit → reply, the happy path for "watched ep N of <title>". */
function updateScript(
  query: string,
  change: Record<string, unknown>,
  reply = "Updated.",
): ScriptStep[] {
  return [
    { toolCalls: [{ name: "search_my_list", arguments: { queries: [query] } }] },
    (req) => {
      const results = lastToolResult(req).results as { anime_id: number }[];
      return {
        toolCalls: [
          { name: "propose_update", arguments: { anime_id: results[0]?.anime_id, ...change } },
        ],
      };
    },
    (req) => ({
      toolCalls: [
        { name: "commit_update", arguments: { proposal_id: lastToolResult(req).proposal_id } },
      ],
    }),
    { text: reply },
  ];
}

function run(message: string, history: { role: "user" | "assistant"; content: string }[] = []) {
  return runAgent(
    {
      db: h.db,
      models,
      writeListStatus: createMalListWriter({
        tokenStore: h.tokenStore,
        apiBaseUrl: h.config.mal.apiBaseUrl,
      }),
      prompt: PROGRESS_SYNC_V1,
    },
    { userId, conversationId: null, history, message, model: LITE },
  );
}

/** Puts these shows on the user's list, in the mirror and on the fake MAL (so commits succeed). */
async function addShows(
  shows: {
    malId: number;
    title: string;
    status: "watching" | "completed" | "plan_to_watch";
    episodes: number;
    total?: number;
  }[],
) {
  await h.db
    .insert(anime)
    .values(shows.map((s) => ({ malId: s.malId, title: s.title, numEpisodes: s.total ?? 12 })));
  h.fakeMal.list.push(
    ...shows.map((s) => ({
      node: {
        id: s.malId,
        title: s.title,
        media_type: "tv",
        num_episodes: s.total ?? 12,
        status: "finished_airing",
      },
      list_status: {
        status: s.status,
        score: 0,
        num_episodes_watched: s.episodes,
        is_rewatching: false,
        updated_at: "2026-09-01T00:00:00+00:00",
      },
    })),
  );
  await h.db.insert(listEntries).values(
    shows.map((s) => ({
      userId,
      animeId: s.malId,
      status: s.status,
      score: 0,
      numEpisodesWatched: s.episodes,
      isRewatching: false,
      malUpdatedAt: new Date(),
      syncedAt: new Date(),
    })),
  );
}

function post(url: string, body?: unknown) {
  return h.app.inject({
    method: "POST",
    url,
    headers: { origin: TEST_WEB_ORIGIN },
    cookies: { [SESSION_COOKIE]: cookie },
    ...(body === undefined ? {} : { payload: body as Record<string, unknown> }),
  });
}

function get(url: string) {
  return h.app.inject({ method: "GET", url, cookies: { [SESSION_COOKIE]: cookie } });
}

function patch(url: string, body: Record<string, unknown>) {
  return h.app.inject({
    method: "PATCH",
    url,
    headers: { origin: TEST_WEB_ORIGIN },
    cookies: { [SESSION_COOKIE]: cookie },
    payload: body,
  });
}

function del(url: string) {
  return h.app.inject({
    method: "DELETE",
    url,
    headers: { origin: TEST_WEB_ORIGIN },
    cookies: { [SESSION_COOKIE]: cookie },
  });
}

/** Sends a message to a chat, or starts a new one. */
async function say(text: string, conversationId?: string) {
  const res = await post("/chat/messages", { text, ...(conversationId && { conversationId }) });
  return contract.chatThreadResponseSchema.parse(res.json());
}

/** Finds a fixture show and stages one more episode of it, which the server holds to confirm. */
const heldScript = (): ScriptStep[] => [
  { toolCalls: [{ name: "search_my_list", arguments: { queries: ["fixture"] } }] },
  (req) => {
    const results = lastToolResult(req).results as { anime_id: number }[];
    return {
      toolCalls: [
        {
          name: "propose_update",
          arguments: { anime_id: results[0]?.anime_id, episodes_delta: 1 },
        },
      ],
    };
  },
  (req) => ({
    toolCalls: [
      { name: "commit_update", arguments: { proposal_id: lastToolResult(req).proposal_id } },
    ],
  }),
  { text: "Please confirm." },
];

describe("runAgent", () => {
  it("searches, proposes and commits, and logs every step", async () => {
    models.script(LITE.ref, updateScript("fixture watching show", { episodes_watched: 8 }));

    const result = await run("watched ep 8 of fixture watching show");

    expect(result).toMatchObject({ outcome: "committed", reply: "Updated.", error: null });
    expect(result.committed).toHaveLength(1);
    expect(h.fakeMal.patchRequests).toEqual([
      { animeId: WATCHING, form: { num_watched_episodes: "8" } },
    ]);

    const [runRow] = await h.db.select().from(agentRuns).where(eq(agentRuns.id, result.runId));
    expect(runRow).toMatchObject({
      promptVersion: "progress-sync@1",
      model: "ollama:test-lite",
      outcome: "committed",
      inputTokens: 400,
      outputTokens: 40,
    });
    expect(runRow?.latencyMs).toEqual(expect.any(Number));

    const steps = await h.db
      .select()
      .from(agentRunSteps)
      .where(eq(agentRunSteps.runId, result.runId))
      .orderBy(asc(agentRunSteps.seq));
    expect(steps.map((s) => (s.kind === "tool_call" ? s.toolName : "model"))).toEqual([
      "model",
      "search_my_list",
      "model",
      "propose_update",
      "model",
      "commit_update",
      "model",
    ]);
    expect(steps[1]?.args).toEqual({ queries: ["fixture watching show"] });
    expect(steps[3]?.args).toEqual({ anime_id: WATCHING, episodes_watched: 8 });
  });

  it("refuses to propose an anime it never looked up", async () => {
    models.script(LITE.ref, [
      {
        toolCalls: [
          { name: "propose_update", arguments: { anime_id: WATCHING, episodes_watched: 8 } },
        ],
      },
      { text: "Done." },
    ]);

    const result = await run("watched ep 8");

    expect(result.outcome).toBe("no_action");
    expect(await h.db.select().from(proposals)).toHaveLength(0);
    const [step] = await h.db
      .select()
      .from(agentRunSteps)
      .where(eq(agentRunSteps.toolName, "propose_update"));
    expect(step?.error).toBe("unknown_anime");
  });

  it("holds a proposal for an unclear match instead of writing it", async () => {
    models.script(LITE.ref, [
      { toolCalls: [{ name: "search_my_list", arguments: { queries: ["fixture"] } }] },
      (req) => {
        const results = lastToolResult(req).results as { anime_id: number; clear_match: boolean }[];
        expect(results.every((r) => !r.clear_match)).toBe(true);
        return {
          toolCalls: [
            {
              name: "propose_update",
              arguments: { anime_id: results[0]?.anime_id, episodes_delta: 1 },
            },
          ],
        };
      },
      (req) => ({
        toolCalls: [
          { name: "commit_update", arguments: { proposal_id: lastToolResult(req).proposal_id } },
        ],
      }),
      { text: "That one needs your confirmation." },
    ]);

    const result = await run("one more ep of fixture");

    expect(result.outcome).toBe("needs_confirmation");
    expect(result.pending).toHaveLength(1);
    expect(h.fakeMal.patchRequests).toHaveLength(0);
  });

  it("counts a held proposal as waiting even when the model never commits it", async () => {
    models.script(LITE.ref, [
      { toolCalls: [{ name: "search_my_list", arguments: { queries: ["fixture"] } }] },
      (req) => {
        const results = lastToolResult(req).results as { anime_id: number }[];
        return {
          toolCalls: [
            {
              name: "propose_update",
              arguments: { anime_id: results[0]?.anime_id, episodes_delta: 1 },
            },
          ],
        };
      },
      (req) => {
        const proposed = lastToolResult(req);
        expect(proposed.requires_confirmation).toBe(true);
        expect(String(proposed.next)).toMatch(/Confirm button/);
        return { text: "That one needs your confirmation." };
      },
    ]);

    const result = await run("one more ep of fixture");

    // Chat shows a Confirm card for it, so the run must say it's waiting, too.
    expect(result.outcome).toBe("needs_confirmation");
    expect(result.pending).toHaveLength(1);
  });

  it("stops a model that keeps committing a held proposal, keeping the Confirm card", async () => {
    let heldId = "";
    const commitAgain = () => ({
      toolCalls: [{ name: "commit_update", arguments: { proposal_id: heldId } }],
    });
    models.script(LITE.ref, [
      { toolCalls: [{ name: "search_my_list", arguments: { queries: ["fixture"] } }] },
      (req) => {
        const results = lastToolResult(req).results as { anime_id: number }[];
        return {
          toolCalls: [
            { name: "propose_update", arguments: { anime_id: results[0]?.anime_id, score: 3 } },
          ],
        };
      },
      (req) => {
        heldId = lastToolResult(req).proposal_id as string;
        return commitAgain();
      },
      commitAgain,
      commitAgain,
      commitAgain,
    ]);

    const result = await run("fixture is a 3");

    expect(result).toMatchObject({
      outcome: "needs_confirmation",
      error: null,
      reply: "That change needs your confirmation.",
    });
    expect(result.pending).toHaveLength(1);
    // It stopped at the second attempt instead of running out of turns.
    expect(models.requests).toHaveLength(4);
    const [logged] = await h.db.select().from(agentRuns).where(eq(agentRuns.id, result.runId));
    expect(logged).toMatchObject({ outcome: "needs_confirmation", error: "repeated_commit" });
  });

  it("stops a model that runs the same search over and over, and asks the user instead", async () => {
    models.script(
      LITE.ref,
      Array.from({ length: 6 }, () => ({
        toolCalls: [
          { name: "search_my_list", arguments: { queries: ["Some Show", "some show 2"] } },
        ],
      })),
    );

    const result = await run("started some show");

    expect(result).toMatchObject({ outcome: "clarification", error: null });
    expect(result.reply).toMatch(/full title\?/);
    expect(models.requests).toHaveLength(3);
    const [logged] = await h.db.select().from(agentRuns).where(eq(agentRuns.id, result.runId));
    expect(logged?.error).toBe("repeated_search");
  });

  it("ends without an error when it runs out of turns after writing", async () => {
    models.script(LITE.ref, [
      ...updateScript("fixture watching show", { episodes_watched: 8 }).slice(0, 3),
      ...Array.from({ length: 3 }, (_, i) => ({
        toolCalls: [{ name: "search_my_list", arguments: { queries: [`x${String(i)}`] } }],
      })),
    ]);

    const result = await run("watched ep 8 of fixture watching show");

    expect(result).toMatchObject({ outcome: "committed", error: null, reply: "Done." });
    const [logged] = await h.db.select().from(agentRuns).where(eq(agentRuns.id, result.runId));
    expect(logged?.error).toBe("max_turns");
  });

  it("only commits proposals from its own run", async () => {
    models.script(LITE.ref, updateScript("fixture watching show", { episodes_watched: 8 }));
    const first = await run("watched ep 8 of fixture watching show");
    const [proposal] = await h.db
      .select({ id: proposals.id })
      .from(proposals)
      .where(eq(proposals.runId, first.runId));

    models.script(LITE.ref, [
      { toolCalls: [{ name: "commit_update", arguments: { proposal_id: proposal?.id } }] },
      { text: "Done." },
    ]);
    const second = await run("commit that again");

    expect(second.committed).toHaveLength(0);
    const [step] = await h.db
      .select()
      .from(agentRunSteps)
      .where(eq(agentRunSteps.runId, second.runId))
      .orderBy(asc(agentRunSteps.seq))
      .offset(1);
    expect(step?.error).toBe("unknown_proposal");
  });

  it("classifies questions, small talk, loops and model failures", async () => {
    models.script(LITE.ref, [{ text: "Which one did you mean: A or B?" }]);
    expect((await run("the isekai one")).outcome).toBe("clarification");

    models.script(LITE.ref, [{ text: "Hi!" }]);
    expect((await run("hello")).outcome).toBe("no_action");

    models.script(
      LITE.ref,
      Array.from({ length: 6 }, (_, i) => ({
        toolCalls: [{ name: "search_my_list", arguments: { queries: [`x${String(i)}`] } }],
      })),
    );
    expect(await run("loop forever")).toMatchObject({ outcome: "error", error: "max_turns" });

    models.script(LITE.ref, [
      { throws: new ModelProviderError("ollama", "rate_limited", "quota", 429) },
    ]);
    expect(await run("anything")).toMatchObject({ outcome: "error", error: "model_rate_limited" });
  });

  it("rejects a misspelled field instead of dropping it", async () => {
    let feedback: Record<string, unknown> = {};
    models.script(LITE.ref, [
      {
        toolCalls: [{ name: "search_my_list", arguments: { queries: ["fixture watching show"] } }],
      },
      {
        toolCalls: [
          {
            name: "propose_update",
            arguments: { anime_id: WATCHING, status: "watching", Episodes_watched: 8 },
          },
        ],
      },
      (req) => {
        feedback = lastToolResult(req);
        return { text: "Sorry, try again." };
      },
    ]);

    const result = await run("watched ep 8 of fixture watching show");

    expect(feedback.error).toBe("invalid_arguments");
    expect(String(feedback.message)).toContain("Unknown field Episodes_watched");
    expect(result.committed).toEqual([]);
    expect(h.fakeMal.patchRequests).toEqual([]);
  });

  it("returns invalid arguments to the model and keeps going", async () => {
    models.script(LITE.ref, [
      { toolCalls: [{ name: "get_entry", arguments: { anime_id: "not-a-number" } }] },
      (req) => {
        expect(lastToolResult(req)).toMatchObject({ error: "invalid_arguments" });
        return { text: "Sorry, which show?" };
      },
    ]);

    expect((await run("??")).outcome).toBe("clarification");
  });
});

describe("the newest episode", () => {
  // On ep 7 of the watching show; AniList says ep 10 airs in two days, so ep 9 is the newest.
  async function seedAiring(overrides: Partial<typeof anilistMedia.$inferInsert> = {}) {
    await h.db.insert(anilistMedia).values({
      malId: WATCHING,
      anilistId: 501,
      status: "RELEASING",
      episodes: 12,
      nextEpisode: 10,
      nextAiringAt: new Date(Date.now() + 2 * 24 * 3600_000),
      fetchedAt: new Date(),
      ...overrides,
    });
  }

  function newestScript(change: Record<string, unknown>, seen: Record<string, unknown>[]) {
    return [
      {
        toolCalls: [{ name: "search_my_list", arguments: { queries: ["fixture watching show"] } }],
      },
      (req) => {
        const results = lastToolResult(req).results as Record<string, unknown>[];
        seen.push(...results);
        return {
          toolCalls: [{ name: "propose_update", arguments: { anime_id: WATCHING, ...change } }],
        };
      },
      (req) => ({
        toolCalls: [
          { name: "commit_update", arguments: { proposal_id: lastToolResult(req).proposal_id } },
        ],
      }),
      { text: "Done." },
    ] satisfies ScriptStep[];
  }

  it("shows the latest aired episode and writes it", async () => {
    await seedAiring();
    const seen: Record<string, unknown>[] = [];
    models.script(LITE.ref, newestScript({ episodes_watched: 9 }, seen));

    const result = await run("watched the newest episode of fixture watching show");

    expect(seen[0]).toMatchObject({ anime_id: WATCHING, latest_aired_episode: 9 });
    expect(result.outcome).toBe("committed");
    expect(h.fakeMal.patchRequests).toEqual([
      { animeId: WATCHING, form: { num_watched_episodes: "9" } },
    ]);
  });

  it("holds any other episode, and holds when the newest episode is unknown", async () => {
    await seedAiring();
    models.script(LITE.ref, newestScript({ episodes_delta: 1 }, []));
    const oneMore = await run("watched the newest episode of fixture watching show");
    expect(oneMore.pending[0]?.confirmationReason).toBe("newest_episode_unknown");

    await h.db.delete(anilistMedia);
    const seen: Record<string, unknown>[] = [];
    models.script(LITE.ref, newestScript({ episodes_watched: 9 }, seen));
    const unknown = await run("caught up on fixture watching show");
    expect(seen[0]).not.toHaveProperty("latest_aired_episode");
    expect(unknown.pending[0]?.confirmationReason).toBe("newest_episode_unknown");
    expect(h.fakeMal.patchRequests).toEqual([]);
  });

  it("leaves it out for finished shows and stale data", async () => {
    await seedAiring({ status: "FINISHED", nextEpisode: null, nextAiringAt: null });
    const finished: Record<string, unknown>[] = [];
    models.script(LITE.ref, newestScript({ episodes_watched: 8 }, finished));
    await run("watched ep 8 of fixture watching show");
    expect(finished[0]).not.toHaveProperty("latest_aired_episode");

    await h.db.delete(anilistMedia);
    await seedAiring({ fetchedAt: new Date(Date.now() - 8 * 24 * 3600_000) });
    const stale: Record<string, unknown>[] = [];
    models.script(LITE.ref, newestScript({ episodes_watched: 8 }, stale));
    await run("watched ep 8 of fixture watching show");
    expect(stale[0]).not.toHaveProperty("latest_aired_episode");
  });
});

describe("the clear-match tie-break", () => {
  /**
   * Three entries whose names all start with "Isekai", so search treats them as seasons of one
   * franchise; only one is in progress, and "isekai" ties them all.
   */
  async function addIsekaiShows() {
    await addShows([
      { malId: 910001, title: "Isekai Alpha", status: "completed", episodes: 12 },
      { malId: 910002, title: "Isekai Beta", status: "plan_to_watch", episodes: 0 },
      { malId: 910003, title: "Isekai Gamma", status: "watching", episodes: 4 },
    ]);
  }

  function tieScript(change: Record<string, unknown>): ScriptStep[] {
    return [
      { toolCalls: [{ name: "search_my_list", arguments: { queries: ["isekai"] } }] },
      (req) => {
        const results = lastToolResult(req).results as { anime_id: number; clear_match: boolean }[];
        const gamma = results.find((r) => r.anime_id === 910003);
        expect(gamma?.clear_match).toBe(true);
        return {
          toolCalls: [{ name: "propose_update", arguments: { anime_id: 910003, ...change } }],
        };
      },
      (req) => ({
        toolCalls: [
          { name: "commit_update", arguments: { proposal_id: lastToolResult(req).proposal_id } },
        ],
      }),
      { text: "Done." },
    ];
  }

  it("lets forward progress through for the one show in progress", async () => {
    await addIsekaiShows();
    models.script(LITE.ref, tieScript({ episodes_delta: 1 }));

    const result = await run("one more ep of the isekai one");

    expect(result.outcome).toBe("committed");
    expect(h.fakeMal.patchRequests).toEqual([
      { animeId: 910003, form: { num_watched_episodes: "5" } },
    ]);
  });

  it("holds anything else for confirmation, as the design asks for 'the isekai one'", async () => {
    await addIsekaiShows();
    models.script(LITE.ref, tieScript({ status: "dropped" }));

    const result = await run("dropping the isekai one");

    expect(result.outcome).toBe("needs_confirmation");
    expect(result.pending[0]?.confirmationReason).toBe("ambiguous_match");
    expect(h.fakeMal.patchRequests).toHaveLength(0);
  });
});

describe("matches grounded in the user's words", () => {
  const SOUL_EATER = 3588;
  const DEVILMAN = 35120;
  const MONSTER = 19;

  type Request = Omit<ChatRequest, "model">;
  /** The first result of the last search. */
  const firstResult = (req: Request) =>
    (lastToolResult(req).results as { anime_id: number; clear_match: boolean }[])[0];
  /** Commits every proposal made so far in the run. */
  const commitAll = (req: Request) => ({
    toolCalls: req.messages.flatMap((m) => {
      if (m.role !== "tool") return [];
      const { proposal_id } = JSON.parse(m.content) as { proposal_id?: string };
      return proposal_id ? [{ name: "commit_update", arguments: { proposal_id } }] : [];
    }),
  });
  const search = (...queries: string[]) => ({
    toolCalls: [{ name: "search_my_list", arguments: { queries } }],
  });
  const propose = (animeId: number, change: Record<string, unknown>) => ({
    name: "propose_update",
    arguments: { anime_id: animeId, ...change },
  });

  it("holds a show the model made up from vague words, and writes the one the user named", async () => {
    await addShows([
      { malId: SOUL_EATER, title: "Soul Eater", status: "plan_to_watch", episodes: 0 },
      { malId: DEVILMAN, title: "Devilman: Crybaby", status: "plan_to_watch", episodes: 0 },
    ]);
    const started = { status: "watching", episodes_watched: 1 };
    models.script(LITE.ref, [
      search("Devilman Crybaby"),
      (req) => {
        expect(firstResult(req)).toEqual(
          expect.objectContaining({ anime_id: DEVILMAN, clear_match: true }),
        );
        // The model's reading of "the eater one".
        return search("Soul Eater", "the eater one");
      },
      (req) => {
        expect(firstResult(req)).toEqual(
          expect.objectContaining({ anime_id: SOUL_EATER, clear_match: false }),
        );
        return { toolCalls: [propose(DEVILMAN, started), propose(SOUL_EATER, started)] };
      },
      commitAll,
      { text: "Started Devilman; confirm Soul Eater." },
    ]);

    const result = await run("Starting devilman crybaby and the eater one");

    expect(h.fakeMal.patchRequests.map((r) => r.animeId)).toEqual([DEVILMAN]);
    expect(result.pending.map((p) => [p.animeId, p.confirmationReason])).toEqual([
      [SOUL_EATER, "ambiguous_match"],
    ]);
  });

  it("counts the user's earlier messages as their words, never the agent's", async () => {
    await addShows([
      { malId: MONSTER, title: "Monster", status: "watching", episodes: 37, total: 74 },
    ]);
    const correction = (episode: number, clear: boolean): ScriptStep[] => [
      search("monster"),
      (req) => {
        expect(firstResult(req)).toEqual(
          expect.objectContaining({ anime_id: MONSTER, clear_match: clear }),
        );
        return { toolCalls: [propose(MONSTER, { episodes_watched: episode })] };
      },
      commitAll,
      { text: "Done." },
    ];

    models.script(LITE.ref, correction(38, true));
    const said = await run("actually I meant ep 38", [
      { role: "user", content: "Just got to ep 37 in monster" },
      { role: "assistant", content: "Updated Monster: you're on episode 37." },
    ]);

    expect(said.outcome).toBe("committed");
    expect(h.fakeMal.patchRequests).toEqual([
      { animeId: MONSTER, form: { num_watched_episodes: "38" } },
    ]);

    // Only the agent named Monster, so the change waits for the user.
    models.script(LITE.ref, correction(39, false));
    const unsaid = await run("actually I meant ep 39", [
      { role: "assistant", content: "Updated Monster: you're on episode 38." },
    ]);

    expect(unsaid.outcome).toBe("needs_confirmation");
    expect(h.fakeMal.patchRequests).toHaveLength(1);
  });
});

describe("chat API", () => {
  it("runs the agent and returns the thread with the change it made", async () => {
    models.script(LITE.ref, updateScript("fixture watching show", { episodes_watched: 8 }));

    const res = await post("/chat/messages", { text: "watched ep 8 of fixture watching show" });

    expect(res.statusCode).toBe(200);
    const body = contract.chatThreadResponseSchema.parse(res.json());
    expect(body.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(body.messages[1]).toMatchObject({
      content: "Updated.",
      pending: [],
      changes: [
        {
          animeId: WATCHING,
          title: "Fixture Watching Show",
          before: { episodesWatched: 7 },
          after: { episodesWatched: 8 },
          undone: false,
          isUndo: false,
        },
      ],
    });

    expect(body.conversation.title).toBe("watched ep 8 of fixture watching show");
    const thread = contract.chatThreadResponseSchema.parse(
      (await get(`/chat/conversations/${body.conversation.id}`)).json(),
    );
    expect(thread.messages).toHaveLength(2);
    const changes = contract.changesResponseSchema.parse((await get("/changes")).json());
    expect(changes.changes).toHaveLength(1);
  });

  it("gives the model the recent conversation", async () => {
    models.script(LITE.ref, [{ text: "Which season?" }, { text: "Got it." }]);

    const first = await say("watched frieren");
    await say("season 2", first.conversation.id);

    // (The first reply is a question, so it also escalated; look at the agent model's calls.)
    const liteCalls = models.requests.filter((r) => r.ref === LITE.ref);
    const second = liteCalls[1]?.request.messages.map((m) => [
      m.role,
      "content" in m ? m.content : "",
    ]);
    expect(second).toEqual([
      ["user", "watched frieren"],
      ["assistant", "Which season?"],
      ["user", "season 2"],
    ]);
  });

  it("escalates to the stronger model when the first one only asks", async () => {
    models.script(LITE.ref, [{ text: "Which show do you mean?" }]);
    models.script(
      FLASH.ref,
      updateScript("fixture watching show", { episodes_watched: 8 }, "Done on Flash."),
    );

    const res = await post("/chat/messages", { text: "watched ep 8 of fixture watching show" });

    const body = contract.chatThreadResponseSchema.parse(res.json());
    expect(body.messages[1]?.content).toBe("Done on Flash.");
    expect(body.messages[1]?.changes).toHaveLength(1);
    const runs = await h.db.select().from(agentRuns).orderBy(asc(agentRuns.startedAt));
    expect(runs.map((r) => [r.model, r.outcome])).toEqual([
      ["ollama:test-lite", "clarification"],
      ["ollama:test-flash", "committed"],
    ]);
    expect(runs[1]?.escalatedFromRunId).toBe(runs[0]?.id);
  });

  it("keeps the first answer when the stronger model fails", async () => {
    models.script(LITE.ref, [{ text: "Which show do you mean?" }]);
    models.script(FLASH.ref, [
      { throws: new ModelProviderError("gemini", "rate_limited", "quota", 429) },
    ]);

    const body = contract.chatThreadResponseSchema.parse(
      (await post("/chat/messages", { text: "the watching one" })).json(),
    );

    expect(body.messages[1]?.content).toBe("Which show do you mean?");
  });

  it("never shows a reply that claims a change nothing made", async () => {
    // A model that pattern-matches an earlier "Updated ..." reply without calling any tools.
    models.script(LITE.ref, [{ text: "Updated Fixture Watching Show: you're on episode 9." }]);
    models.script(FLASH.ref, [{ text: "Updated it again." }]);

    const body = contract.chatThreadResponseSchema.parse(
      (await post("/chat/messages", { text: "two more of that one" })).json(),
    );

    expect(body.messages[1]?.content).toMatch(/didn't change anything/);
    expect(body.messages[1]?.changes).toEqual([]);
    // The model's own words stay in the run log for debugging.
    const [step] = await h.db
      .select()
      .from(agentRunSteps)
      .where(eq(agentRunSteps.kind, "model_call"));
    expect(JSON.stringify(step?.result)).toContain("Updated Fixture Watching Show");
  });

  it("keeps an honest reply when MAL turns the change down", async () => {
    h.fakeMal.patchFailures = [400];
    models.script(
      LITE.ref,
      updateScript(
        "fixture watching show",
        { episodes_watched: 8 },
        "Fixture Watching Show could not be updated right now.",
      ),
    );

    const body = contract.chatThreadResponseSchema.parse(
      (await post("/chat/messages", { text: "watched ep 8 of fixture watching show" })).json(),
    );

    expect(body.messages[1]).toMatchObject({
      content: "Fixture Watching Show could not be updated right now.",
      changes: [],
      pending: [],
    });
    expect(h.fakeMal.patchRequests).toHaveLength(1);
    expect(models.requests.map((r) => r.ref)).not.toContain(FLASH.ref);
  });

  it("says MAL turned the change down, not 'tell me again', when the reply claims it worked", async () => {
    h.fakeMal.patchFailures = [400];
    models.script(
      LITE.ref,
      updateScript("fixture watching show", { episodes_watched: 8 }, "Updated it to episode 8."),
    );

    const body = contract.chatThreadResponseSchema.parse(
      (await post("/chat/messages", { text: "watched ep 8 of fixture watching show" })).json(),
    );

    expect(body.messages[1]?.content).toBe(
      "MyAnimeList didn't accept the change, so your list is unchanged. Try again in a minute.",
    );
    expect(body.messages[1]?.changes).toEqual([]);
    const [runRow] = await h.db.select().from(agentRuns);
    expect(runRow?.outcome).toBe("no_action");
  });

  it("explains a missing API key without escalating", async () => {
    models.script(LITE.ref, [
      { throws: new ModelProviderError("gemini", "auth", "GEMINI_API_KEY is not set") },
    ]);

    const body = contract.chatThreadResponseSchema.parse(
      (await post("/chat/messages", { text: "hi" })).json(),
    );

    expect(body.messages[1]?.content).toMatch(/GEMINI_API_KEY/);
    expect(models.requests.map((r) => r.ref)).toEqual(["ollama:test-lite"]);
  });

  it("confirms a held proposal, and cancels another", async () => {
    // Escalation holds too, so the held proposal is what the user sees.
    models.script(LITE.ref, heldScript());
    models.script(FLASH.ref, heldScript());

    const first = contract.chatThreadResponseSchema.parse(
      (await post("/chat/messages", { text: "one more of fixture" })).json(),
    );
    const pending = first.messages[1]?.pending[0];
    expect(pending?.reason).toBe("ambiguous_match");
    expect(pending?.change.episodesWatched).toEqual(expect.any(Number));

    const confirm = await post(`/proposals/${pending?.id ?? ""}/confirm`);
    expect(confirm.statusCode).toBe(200);
    expect(contract.changeResponseSchema.parse(confirm.json()).change.animeId).toBe(
      pending?.animeId,
    );
    expect(h.fakeMal.patchRequests).toHaveLength(1);

    const thread = contract.chatThreadResponseSchema.parse(
      (await get(`/chat/conversations/${first.conversation.id}`)).json(),
    );
    expect(thread.messages[1]?.pending).toEqual([]);
    expect(thread.messages[1]?.changes).toHaveLength(1);

    models.script(LITE.ref, heldScript());
    models.script(FLASH.ref, heldScript());
    const second = contract.chatThreadResponseSchema.parse(
      (await post("/chat/messages", { text: "one more of fixture" })).json(),
    );
    const cancel = await post(`/proposals/${second.messages[1]?.pending[0]?.id ?? ""}/cancel`);
    expect(cancel.statusCode).toBe(204);
    expect(h.fakeMal.patchRequests).toHaveLength(1);
  });

  it("undoes a change once", async () => {
    models.script(LITE.ref, updateScript("fixture watching show", { episodes_watched: 8 }));
    const body = contract.chatThreadResponseSchema.parse(
      (await post("/chat/messages", { text: "watched ep 8 of fixture watching show" })).json(),
    );
    const changeId = body.messages[1]?.changes[0]?.id ?? "";

    const undo = await post(`/changes/${changeId}/undo`);
    expect(undo.statusCode).toBe(200);
    expect(contract.changeResponseSchema.parse(undo.json()).change).toMatchObject({
      isUndo: true,
      after: { episodesWatched: 7 },
    });
    const again = await post(`/changes/${changeId}/undo`);
    expect(again.statusCode).toBe(409);
    expect(contract.writeErrorResponseSchema.parse(again.json()).error).toBe("already_undone");

    const log = contract.changesResponseSchema.parse((await get("/changes")).json());
    expect(log.changes.map((c) => [c.isUndo, c.undone])).toEqual([
      [true, false],
      [false, true],
    ]);
  });

  it("limits how fast a user can send messages", async () => {
    models.script(
      LITE.ref,
      Array.from({ length: 10 }, () => ({ text: "ok" })),
    );
    for (let i = 0; i < 10; i++) {
      expect((await post("/chat/messages", { text: `msg ${String(i)}` })).statusCode).toBe(200);
    }
    const limited = await post("/chat/messages", { text: "one too many" });
    expect(limited.statusCode).toBe(429);
    expect(models.requests).toHaveLength(10);
  });

  it("requires a session, the web origin and a message", async () => {
    const anonymous = await h.app.inject({
      method: "POST",
      url: "/chat/messages",
      headers: { origin: TEST_WEB_ORIGIN },
      payload: { text: "hi" },
    });
    const crossSite = await h.app.inject({
      method: "POST",
      url: "/chat/messages",
      headers: { origin: "https://evil.example" },
      cookies: { [SESSION_COOKIE]: cookie },
      payload: { text: "hi" },
    });
    const empty = await post("/chat/messages", { text: "   " });

    expect([anonymous.statusCode, crossSite.statusCode, empty.statusCode]).toEqual([401, 403, 400]);
    expect(models.requests).toHaveLength(0);
  });
});

describe("chats", () => {
  it("starts a new chat for a message without one, and lists chats by latest message", async () => {
    models.script(LITE.ref, [{ text: "Hi!" }, { text: "Sure." }, { text: "Ok." }]);

    const first = await say("hi there");
    const second = await say(
      "  what should I   watch tonight,\n something chill and short since I only have forty minutes",
    );
    expect(second.conversation.id).not.toBe(first.conversation.id);
    // Titles are the first message on one line, cut at a word.
    expect(second.conversation.title).toBe(
      "what should I watch tonight, something chill and short…",
    );
    await say("and another thing", first.conversation.id);

    const list = contract.conversationsResponseSchema.parse(
      (await get("/chat/conversations")).json(),
    );
    expect(list.conversations.map((c) => c.title)).toEqual([
      "hi there",
      "what should I watch tonight, something chill and short…",
    ]);
  });

  it("shows cards for the shows a question names, to answer it with", async () => {
    models.script(LITE.ref, [
      {
        toolCalls: [
          {
            name: "search_my_list",
            arguments: { queries: ["Fixture Watching Show", "Fixture Paused Show"] },
          },
        ],
      },
      { text: "Did you mean Fixture Paused Show or Fixture Watching Show?" },
    ]);

    const chat = await say("watched another ep of the fixture one");

    const reply = chat.messages[1];
    expect(reply?.asksToChoose).toBe(true);
    expect(reply?.shows.map((s) => [s.title, s.status, s.episodesWatched])).toEqual([
      ["Fixture Paused Show", "on_hold", expect.any(Number)],
      ["Fixture Watching Show", "watching", 7],
    ]);
    // The cards come back with the chat.
    const thread = contract.chatThreadResponseSchema.parse(
      (await get(`/chat/conversations/${chat.conversation.id}`)).json(),
    );
    expect(thread.messages[1]?.shows).toHaveLength(2);
  });

  it("doesn't repeat a show that already has a change card", async () => {
    models.script(
      LITE.ref,
      updateScript(
        "fixture watching show",
        { episodes_watched: 8 },
        "Updated Fixture Watching Show to episode 8.",
      ),
    );

    const chat = await say("watched ep 8 of fixture watching show");

    expect(chat.messages[1]?.changes).toHaveLength(1);
    expect(chat.messages[1]?.shows).toEqual([]);
    expect(chat.messages[1]?.asksToChoose).toBe(false);
  });

  it("gives the model only the chat's own messages", async () => {
    models.script(LITE.ref, [{ text: "Which season?" }, { text: "Hello!" }]);

    await say("watched frieren");
    await say("hello");

    const liteCalls = models.requests.filter((r) => r.ref === LITE.ref);
    expect(liteCalls.at(-1)?.request.messages.map((m) => m.content)).toEqual(["hello"]);
  });

  it("names a chat from before titles after its first message", async () => {
    const [chat] = await h.db.insert(conversations).values({ userId }).returning();
    if (!chat) throw new Error("no chat");
    await h.db.insert(chatMessages).values([
      { conversationId: chat.id, role: "user", content: "watched ep 3 of frieren" },
      { conversationId: chat.id, role: "assistant", content: "Updated." },
    ]);

    const list = contract.conversationsResponseSchema.parse(
      (await get("/chat/conversations")).json(),
    );
    expect(list.conversations.map(({ id, title }) => ({ id, title }))).toEqual([
      { id: chat.id, title: "watched ep 3 of frieren" },
    ]);
  });

  it("renames a chat, on one line and within the limit", async () => {
    models.script(LITE.ref, [{ text: "Hi!" }]);
    const chat = await say("hi there");
    const url = `/chat/conversations/${chat.conversation.id}`;

    const res = await patch(url, { title: "  Frieren\n  catch-up " });

    expect(res.statusCode).toBe(200);
    expect(contract.conversationResponseSchema.parse(res.json()).conversation).toMatchObject({
      id: chat.conversation.id,
      title: "Frieren catch-up",
    });
    const list = contract.conversationsResponseSchema.parse(
      (await get("/chat/conversations")).json(),
    );
    expect(list.conversations.map((c) => c.title)).toEqual(["Frieren catch-up"]);

    const invalid = [
      await patch(url, { title: "   " }),
      await patch(url, { title: "x".repeat(101) }),
      await patch(url, {}),
    ];
    expect(invalid.map((r) => [r.statusCode, r.json<{ error: string }>().error])).toEqual([
      [400, "invalid_title"],
      [400, "invalid_title"],
      [400, "invalid_title"],
    ]);
    expect((await patch(url, { title: "x".repeat(100) })).statusCode).toBe(200);
  });

  it("deletes a chat and cancels the changes it held, keeping the ones it made", async () => {
    models.script(LITE.ref, updateScript("fixture watching show", { episodes_watched: 8 }));
    const chat = await say("watched ep 8 of fixture watching show");
    models.script(LITE.ref, heldScript());
    models.script(FLASH.ref, heldScript());
    await say("one more of fixture", chat.conversation.id);

    const res = await del(`/chat/conversations/${chat.conversation.id}`);

    expect(res.statusCode).toBe(204);
    expect((await get(`/chat/conversations/${chat.conversation.id}`)).statusCode).toBe(404);
    expect(
      contract.conversationsResponseSchema.parse((await get("/chat/conversations")).json()),
    ).toEqual({ conversations: [] });
    const statuses = (await h.db.select({ status: proposals.status }).from(proposals))
      .map((p) => p.status)
      .sort();
    expect(statuses).toEqual(["cancelled", "cancelled", "committed"]);
    const changes = contract.changesResponseSchema.parse((await get("/changes")).json());
    expect(changes.changes).toHaveLength(1);
    expect((await del(`/chat/conversations/${chat.conversation.id}`)).statusCode).toBe(404);
  });

  it("won't show, continue or delete another user's chat", async () => {
    const [other] = await h.db
      .insert(users)
      .values({ malUserId: 424242, malUsername: "someone-else" })
      .returning();
    if (!other) throw new Error("no user");
    const [chat] = await h.db.insert(conversations).values({ userId: other.id }).returning();
    if (!chat) throw new Error("no chat");
    await h.db
      .insert(chatMessages)
      .values({ conversationId: chat.id, role: "user", content: "a secret" });

    const shown = await get(`/chat/conversations/${chat.id}`);
    const continued = await post("/chat/messages", { text: "hi", conversationId: chat.id });
    const renamed = await patch(`/chat/conversations/${chat.id}`, { title: "mine now" });
    const deleted = await del(`/chat/conversations/${chat.id}`);
    const listed = contract.conversationsResponseSchema.parse(
      (await get("/chat/conversations")).json(),
    );

    expect([shown, continued, renamed, deleted].map((r) => r.statusCode)).toEqual([
      404, 404, 404, 404,
    ]);
    expect(listed.conversations).toEqual([]);
    expect(models.requests).toHaveLength(0);
    expect(await h.db.select().from(conversations)).toHaveLength(1);
    expect((await get("/chat/conversations/not-a-uuid")).statusCode).toBe(404);
  });
});

describe("logging", () => {
  it("never writes MAL tokens or codes to the logs during agent runs", async () => {
    models.script(LITE.ref, updateScript("fixture watching show", { episodes_watched: 8 }));
    await post("/chat/messages", { text: "watched ep 8" });

    const logs = h.logs.text;
    for (const secret of h.fakeMal.issuedSecrets) expect(logs).not.toContain(secret);
  });
});
