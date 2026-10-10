import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { ASK_PROMPT } from "../../src/agent/prompts/index.js";
import { diaryNotes, dropReasons, embeddings, listEntries, users } from "../../src/db/schema.js";
import { askList } from "../../src/lab/ask.js";
import { ensureListDocuments, listDocuments } from "../../src/lab/documents.js";
import { retrieve } from "../../src/lab/retrieve.js";
import { parseModelRef } from "../../src/llm/modelConfig.js";
import { fixtureList } from "../fixtures/animeList.js";
import { ConceptEmbedder } from "../support/conceptEmbedder.js";
import { login, resetDatabase, startHarness, type Harness } from "../support/harness.js";
import { ScriptedModels } from "../support/scriptedModels.js";

const ASK = parseModelRef("ollama:test-ask");
const WATCHING = 900001; // Fixture Watching Show: watching, 7 / 12
const DROPPED = 900004; // Fixture Dropped Show

let h: Harness;
let userId: string;
const models = new ScriptedModels();

beforeAll(async () => {
  h = await startHarness();
});
afterAll(async () => {
  await h.close();
});
beforeEach(async () => {
  await resetDatabase(h.db);
  h.fakeMal.reset();
  h.fakeMal.list = fixtureList();
  models.reset();
  await login(h);
  const [user] = await h.db.select({ id: users.id }).from(users);
  if (!user) throw new Error("no user");
  userId = user.id;
});

/** Each fixture show's document, by MAL id. */
async function documentsById(): Promise<Map<number, string>> {
  return new Map((await listDocuments(h.db, userId)).map((doc) => [doc.malId, doc.text]));
}

describe("the list as documents (Milestone 7's RAG)", () => {
  it("writes one document per entry, with the user's own words about it", async () => {
    await h.db.insert(dropReasons).values({
      userId,
      animeId: DROPPED,
      category: "too_slow",
      said: "dropped it, way too slow",
    });
    await h.db
      .insert(diaryNotes)
      .values({ userId, animeId: WATCHING, text: "that fight in ep 7 was insane" });

    const docs = await documentsById();
    expect(docs.size).toBe(fixtureList().length);
    const watching = docs.get(WATCHING) ?? "";
    expect(watching).toMatch(/^Fixture Watching Show/);
    expect(watching).toContain("On my list: Watching; watched 7 of 12 episodes");
    expect(watching).toMatch(/My note \(\d{4}-\d{2}-\d{2}\): "that fight in ep 7 was insane"/);
    expect(docs.get(DROPPED)).toContain('Why I dropped it: too slow ("dropped it, way too slow").');
  });

  it("embeds only changed documents, and drops the ones of shows that left the list", async () => {
    const embedder = new ConceptEmbedder({});
    const first = await ensureListDocuments({ db: h.db, embedder }, userId);
    expect(first.embedded).toBe(fixtureList().length);

    await h.db.insert(diaryNotes).values({ userId, animeId: WATCHING, text: "so good" });
    await h.db
      .delete(listEntries)
      .where(and(eq(listEntries.userId, userId), eq(listEntries.animeId, DROPPED)));
    const second = await ensureListDocuments({ db: h.db, embedder }, userId);
    expect(second).toMatchObject({ embedded: 1, removed: 1 });
    const refs = (
      await h.db
        .select({ ref: embeddings.ref })
        .from(embeddings)
        .where(eq(embeddings.userId, userId))
    ).map((row) => Number(row.ref));
    expect(refs).not.toContain(DROPPED);
    expect(refs).toContain(WATCHING);
  });

  it("finds documents by meaning and by the names in the question", async () => {
    const docs = await documentsById();
    const embedder = new ConceptEmbedder({
      "which show did i give up on because it dragged": "slow",
      [(docs.get(DROPPED) ?? "").toLowerCase()]: "slow",
    });
    await ensureListDocuments({ db: h.db, embedder }, userId);

    const byMeaning = await retrieve(
      { db: h.db, embedder },
      userId,
      "which show did I give up on because it dragged",
    );
    expect(byMeaning.byMeaning[0]).toBe(DROPPED);
    expect(byMeaning.documents[0]).toMatchObject({ malId: DROPPED, nameScore: null });

    const byName = await retrieve(
      { db: h.db, embedder },
      userId,
      "how far am I in fixture watching show?",
    );
    expect(byName.byName[0]).toBe(WATCHING);
    expect(byName.documents[0]?.malId).toBe(WATCHING);
    expect(byName.documents[0]?.text).toContain("watched 7 of 12");
  });

  it("answers from the retrieved documents, keeping only citations of documents it was given", async () => {
    const embedder = new ConceptEmbedder({});
    await ensureListDocuments({ db: h.db, embedder }, userId);
    models.script(ASK.ref, [
      { text: `You're on episode 7 of 12 [${String(WATCHING)}]. Also see [123456].` },
    ]);
    const result = await askList(
      { db: h.db, embedder, models },
      {
        userId,
        question: "how far am I in fixture watching show?",
        model: ASK,
        prompt: ASK_PROMPT,
      },
    );

    const sent = models.requests[0]?.request;
    expect(sent?.system).toBe(ASK_PROMPT.system);
    expect(sent?.tools).toEqual([]);
    const content = sent?.messages[0]?.content ?? "";
    expect(content).toContain("My question: how far am I in fixture watching show?");
    expect(content).toContain(`[${String(WATCHING)}] Fixture Watching Show`);
    expect(result.cited).toEqual([WATCHING]);
    expect(result.strayCitations).toEqual([123456]);
    expect(result).toMatchObject({ model: ASK.ref, promptVersion: ASK_PROMPT.version });
  });
});
