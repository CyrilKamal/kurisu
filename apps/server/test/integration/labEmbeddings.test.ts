import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, inject, it } from "vitest";

import { createDb } from "../../src/db/client.js";
import { embeddings, users } from "../../src/db/schema.js";
import { ensureEmbeddings, nearest, queryVector } from "../../src/lab/embeddings.js";
import { FakeEmbedder } from "../support/fakeEmbedder.js";

const { db, close } = createDb(inject("databaseUrl"));
const embedder = new FakeEmbedder();
const deps = { db, embedder };

afterAll(() => close());
beforeEach(async () => {
  await db.execute(sql`TRUNCATE users, embeddings CASCADE`);
  embedder.reset();
});

const shows = [
  { ref: "1", text: "Cowboy Bebop · bounty hunters in space with jazz" },
  { ref: "2", text: "Kids on the Slope · jazz music and friendship at school" },
  { ref: "3", text: "Mushishi · a wanderer studies quiet spirits in the countryside" },
];

describe("lab embeddings (pgvector)", () => {
  it("embeds only new or changed texts", async () => {
    expect(await ensureEmbeddings(deps, "synopsis", shows)).toMatchObject({ embedded: 3, kept: 0 });
    expect(embedder.calls).toEqual([{ texts: shows.map((s) => s.text), purpose: "document" }]);

    expect(await ensureEmbeddings(deps, "synopsis", shows)).toMatchObject({ embedded: 0, kept: 3 });
    const changed = [
      { ...shows[0], text: "Cowboy Bebop · a crew of bounty hunters" },
      ...shows.slice(1),
    ];
    expect(await ensureEmbeddings(deps, "synopsis", changed as typeof shows)).toMatchObject({
      embedded: 1,
      kept: 2,
    });
    const rows = await db.select().from(embeddings);
    expect(rows).toHaveLength(3);
    expect(rows.find((r) => r.ref === "1")?.text).toBe("Cowboy Bebop · a crew of bounty hunters");
  });

  it("finds the closest texts by meaning, within a kind, owner and set of refs", async () => {
    await ensureEmbeddings(deps, "synopsis", shows);
    const jazz = await queryVector(embedder, "jazz music and friendship");
    expect(embedder.calls.at(-1)?.purpose).toBe("query");

    const found = await nearest(deps, "synopsis", jazz, { k: 2 });
    expect(found.map((n) => n.ref)).toEqual(["2", "1"]);
    expect(found[0]?.similarity).toBeGreaterThan(found[1]?.similarity ?? 1);

    // Another kind, or only some shows.
    expect(await nearest(deps, "title", jazz, { k: 2 })).toEqual([]);
    expect(
      (await nearest(deps, "synopsis", jazz, { k: 3, refs: ["1", "3"] })).map((n) => n.ref),
    ).toEqual(["1", "3"]);
    expect(await nearest(deps, "synopsis", jazz, { k: 3, refs: [] })).toEqual([]);
  });

  it("keeps each user's history to themselves", async () => {
    const [alice, bob] = await db
      .insert(users)
      .values([
        { malUserId: 1, malUsername: "alice" },
        { malUserId: 2, malUsername: "bob" },
      ])
      .returning({ id: users.id });
    if (!alice || !bob) throw new Error("no users");
    await ensureEmbeddings(deps, "history", [{ ref: "note-1", text: "loved the jazz" }], {
      userId: alice.id,
    });
    const jazz = await queryVector(embedder, "jazz");
    expect(
      (await nearest(deps, "history", jazz, { k: 5, userId: alice.id })).map((n) => n.ref),
    ).toEqual(["note-1"]);
    expect(await nearest(deps, "history", jazz, { k: 5, userId: bob.id })).toEqual([]);
    expect(await nearest(deps, "history", jazz, { k: 5 })).toEqual([]);
  });

  it("stores each shared text once, whatever its owner column says", async () => {
    await ensureEmbeddings(deps, "title", [{ ref: "1", text: "Cowboy Bebop" }]);
    await ensureEmbeddings(deps, "title", [{ ref: "1", text: "Cowboy Bebop (1998)" }]);
    const rows = await db.select().from(embeddings);
    expect(rows).toHaveLength(1);
    // The HNSW index exists, so pgvector is really installed.
    const index = await db.execute<{ indexdef: string }>(
      sql`SELECT indexdef FROM pg_indexes WHERE indexname = 'embeddings_vector_idx'`,
    );
    expect(index.rows[0]?.indexdef).toMatch(/USING hnsw .*vector_cosine_ops/);
  });
});
