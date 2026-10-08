import { eq, inArray } from "drizzle-orm";
import { z } from "zod";

import type { Prompt } from "../agent/runAgent.js";
import { runToolLoop, type ToolOutcome } from "../agent/toolLoop.js";
import type { Db } from "../db/client.js";
import { agentRuns, anime, diaryNotes } from "../db/schema.js";
import type { ModelClient } from "../llm/modelClient.js";
import type { ModelRef } from "../llm/modelConfig.js";
import type { ToolCall, ToolSpec } from "../llm/types.js";
import { reactionWords } from "./notes.js";

export interface DiaryDeps {
  db: Db;
  models: ModelClient;
  model: ModelRef;
  prompt: Prompt;
}

/** A show the message updated: its committed change, for the note to hang on. */
export interface UpdatedShow {
  animeId: number;
  title: string;
  changeId: string;
}

const SAVE_TOOL: ToolSpec = {
  name: "save_reactions",
  description:
    "Save how the user said they felt about the shows the message updated, in their exact words. Pass no reactions if they said nothing about how they felt.",
  parameters: {
    type: "object",
    properties: {
      reactions: {
        type: "array",
        items: {
          type: "object",
          properties: {
            anime_id: { type: "integer" },
            words: { type: "string", description: "Their words about it, copied exactly" },
          },
          required: ["anime_id", "words"],
        },
      },
    },
    required: ["reactions"],
  },
};

const saveArgs = z.object({
  reactions: z
    .array(z.object({ anime_id: z.coerce.number().int().positive(), words: z.string() }))
    .nullish()
    .transform((r) => r ?? []),
});

/**
 * Has the model read the message for reactions to the shows it updated, logged as an agent run.
 * Returns each reaction in the user's own words (see reactionWords), one per show at most and
 * only for the shows given, or null if the model never answered.
 */
export async function readReactions(
  deps: DiaryDeps,
  userId: string,
  message: string,
  shows: Omit<UpdatedShow, "changeId">[],
): Promise<{ animeId: number; text: string }[] | null> {
  const started = performance.now();
  const [run] = await deps.db
    .insert(agentRuns)
    .values({ userId, promptVersion: deps.prompt.version, model: deps.model.ref })
    .returning({ id: agentRuns.id });
  if (!run) throw new Error("agent_runs insert returned no row");

  const ids = new Set(shows.map((s) => s.animeId));
  const state: { found: { animeId: number; text: string }[] | null } = { found: null };
  const execute = (call: ToolCall): Promise<ToolOutcome> => {
    const args = call.name === "save_reactions" ? saveArgs.safeParse(call.arguments) : null;
    if (!args?.success) {
      return Promise.resolve({
        result: { error: "invalid_arguments", message: "Call save_reactions with reactions." },
        error: "invalid_arguments",
      });
    }
    const found = new Map<number, string>();
    for (const r of args.data.reactions) {
      const words = r.words.trim();
      if (ids.has(r.anime_id) && words && !found.has(r.anime_id)) {
        found.set(r.anime_id, reactionWords(message, words));
      }
    }
    state.found = [...found].map(([animeId, text]) => ({ animeId, text }));
    return Promise.resolve({ result: { status: "saved", reactions: found.size } });
  };

  const loop = await runToolLoop({
    db: deps.db,
    runId: run.id,
    models: deps.models,
    model: deps.model,
    system: deps.prompt.system,
    tools: [SAVE_TOOL],
    messages: [
      {
        role: "user",
        content: [
          `Message: ${message}`,
          "Shows it updated:",
          ...shows.map((s) => `- anime_id ${String(s.animeId)}: ${s.title}`),
        ].join("\n"),
      },
    ],
    // One more turn if the first call's arguments didn't hold up.
    maxTurns: 2,
    execute,
    shouldStop: () => state.found !== null,
  });
  await deps.db
    .update(agentRuns)
    .set({
      finishedAt: new Date(),
      latencyMs: Math.round(performance.now() - started),
      inputTokens: loop.inputTokens,
      outputTokens: loop.outputTokens,
      outcome: state.found ? "no_action" : "error",
      error: state.found ? null : (loop.error ?? "not_reported"),
    })
    .where(eq(agentRuns.id, run.id));
  return state.found;
}

/**
 * Saves the reactions in a message to the diary, each with the change it came with. Returns how
 * many were saved. A failed read saves nothing: the updates themselves are already done.
 */
export async function saveReactions(
  deps: DiaryDeps,
  userId: string,
  message: string,
  shows: UpdatedShow[],
): Promise<number> {
  if (shows.length === 0) return 0;
  const found = await readReactions(deps, userId, message, shows);
  if (!found || found.length === 0) return 0;
  const changeFor = new Map(shows.map((s) => [s.animeId, s.changeId]));
  const rows = found.flatMap(({ animeId, text }) => {
    const changeId = changeFor.get(animeId);
    return changeId ? [{ userId, animeId, changeId, text }] : [];
  });
  if (rows.length === 0) return 0;
  const saved = await deps.db
    .insert(diaryNotes)
    .values(rows)
    .onConflictDoNothing({ target: diaryNotes.changeId })
    .returning({ id: diaryNotes.id });
  return saved.length;
}

/** saveReactions for a message's committed changes, with the shows' titles from the mirror. */
export async function saveReactionsFor(
  deps: DiaryDeps,
  userId: string,
  message: string,
  committed: { animeId: number; changeId: string }[],
): Promise<number> {
  if (committed.length === 0) return 0;
  const titles = new Map(
    (
      await deps.db
        .select({ malId: anime.malId, title: anime.title })
        .from(anime)
        .where(
          inArray(
            anime.malId,
            committed.map((c) => c.animeId),
          ),
        )
    ).map((row) => [row.malId, row.title]),
  );
  // The last change per show is the one a note hangs on.
  const last = new Map(committed.map((c) => [c.animeId, c.changeId]));
  return saveReactions(
    deps,
    userId,
    message,
    [...last].map(([animeId, changeId]) => ({
      animeId,
      changeId,
      title: titles.get(animeId) ?? `#${String(animeId)}`,
    })),
  );
}
