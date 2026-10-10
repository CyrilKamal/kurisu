/**
 * Asks a question about a user's list, answered from its documents (Milestone 7's RAG). Embeds
 * any new or changed documents first. Reads DATABASE_URL from .env.local:
 *
 *   pnpm lab:ask "what did I drop for being slow?"
 *   pnpm lab:ask --user <mal username> --model gemini:gemini-3.5-flash-lite "…"
 *
 * Without --user it asks about the owner's list (or the only user's). Prints the documents it
 * found, the answer and its run: the model, prompt version, latency and tokens.
 */
import { parseArgs } from "node:util";

import { ASK_PROMPT, ASK_PROMPTS } from "../agent/prompts/index.js";
import { loadConfig } from "../config.js";
import { createDb } from "../db/client.js";
import { users } from "../db/schema.js";
import { loadLocalEnvFile } from "../env.js";
import { askList } from "../lab/ask.js";
import { ensureListDocuments } from "../lab/documents.js";
import { createEmbedder, createModelClient } from "../llm/modelClient.js";
import { loadModelsFile, parseModelRef, resolveEmbedding, resolveLab } from "../llm/modelConfig.js";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    user: { type: "string" },
    model: { type: "string" },
    prompt: { type: "string" },
  },
});
const question = positionals.join(" ").trim();
if (!question) {
  console.error('Ask something: pnpm lab:ask "what did I drop for being slow?"');
  process.exit(1);
}
const version = values.prompt ?? ASK_PROMPT.version;
if (!Object.hasOwn(ASK_PROMPTS, version)) {
  console.error(`Unknown prompt "${version}". Known: ${Object.keys(ASK_PROMPTS).join(", ")}`);
  process.exit(1);
}
const prompt = ASK_PROMPTS[version as keyof typeof ASK_PROMPTS];

loadLocalEnvFile();
const config = loadConfig();
const modelsFile = loadModelsFile();
const model = values.model ? parseModelRef(values.model) : resolveLab(modelsFile).ask;
const clientOptions = {
  geminiApiKey: config.llm.geminiApiKey,
  ollamaBaseUrl: config.llm.ollamaBaseUrl,
  ollama: modelsFile.ollama,
};
const embedder = createEmbedder({
  ...clientOptions,
  ref: resolveEmbedding(modelsFile, config.llm.embeddingModel ?? undefined),
});
const models = createModelClient(clientOptions);

const { db, close } = createDb(config.databaseUrl);
try {
  const all = await db
    .select({ id: users.id, name: users.malUsername, isOwner: users.isOwner })
    .from(users);
  const user = values.user
    ? all.find((u) => u.name === values.user)
    : (all.find((u) => u.isOwner) ?? (all.length === 1 ? all[0] : undefined));
  if (!user) {
    console.error(
      values.user
        ? `No user named ${values.user}.`
        : `Pass --user; this database has ${String(all.length)} users and no owner.`,
    );
    process.exit(1);
  }

  const { documents, embedded, removed } = await ensureListDocuments({ db, embedder }, user.id);
  console.log(
    `${user.name}'s list: ${String(documents.length)} documents (${String(embedded)} embedded now, ${String(removed)} removed).`,
  );
  const result = await askList(
    { db, embedder, models },
    { userId: user.id, question, model, prompt },
  );
  const titles = new Map(documents.map((doc) => [doc.malId, doc.title]));
  console.log("\nRetrieved:");
  for (const doc of result.retrieval.documents) {
    const why = [
      doc.similarity === null ? null : `meaning ${doc.similarity.toFixed(3)}`,
      doc.nameScore === null ? null : `name ${doc.nameScore.toFixed(2)}`,
    ].filter(Boolean);
    console.log(`  [${String(doc.malId)}] ${titles.get(doc.malId) ?? "?"}  (${why.join(", ")})`);
  }
  console.log(`\n${result.answer}\n`);
  if (result.strayCitations.length > 0) {
    console.log(`Cited documents it wasn't given: ${result.strayCitations.join(", ")}`);
  }
  console.log(
    `${result.model}, ${result.promptVersion}, ${String(result.latencyMs)} ms, ${String(result.inputTokens)} tokens in / ${String(result.outputTokens)} out`,
  );
} finally {
  await close();
}
