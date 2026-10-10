import type { Db } from "../db/client.js";
import type { ModelClient, Embedder } from "../llm/modelClient.js";
import type { ModelRef } from "../llm/modelConfig.js";
import { retrieve, RETRIEVE_K, type Retrieval } from "./retrieve.js";

export interface AskPrompt {
  version: string;
  system: string;
}

export interface AskResult {
  answer: string;
  /** The documents the answer cites, in the order it first cites them; only retrieved ones. */
  cited: number[];
  /** Ids the answer cites that it wasn't given: a made-up source. */
  strayCitations: number[];
  retrieval: Retrieval;
  model: string;
  promptVersion: string;
  /** Retrieval and the model call, end to end. */
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
}

/**
 * Answers a question about the user's list from its documents (Milestone 7's RAG): retrieves the
 * closest ones, then asks the model to answer from them alone, citing each fact. One model call,
 * no tools. A lab tool: nothing in the app calls it.
 */
export async function askList(
  deps: { db: Db; embedder: Embedder; models: ModelClient },
  input: { userId: string; question: string; model: ModelRef; prompt: AskPrompt; k?: number },
): Promise<AskResult> {
  const started = performance.now();
  const retrieval = await retrieve(deps, input.userId, input.question, input.k ?? RETRIEVE_K);
  const documents = retrieval.documents
    .map((doc) => `[${String(doc.malId)}] ${doc.text}`)
    .join("\n\n");
  const response = await deps.models.chat(input.model, {
    system: input.prompt.system,
    messages: [
      {
        role: "user",
        content: `My question: ${input.question}\n\nDocuments from my list:\n\n${documents || "(none)"}`,
      },
    ],
    tools: [],
  });
  const answer = response.text.trim();
  const given = new Set(retrieval.documents.map((doc) => doc.malId));
  const ids = [...new Set([...answer.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1])))];
  return {
    answer,
    cited: ids.filter((id) => given.has(id)),
    strayCitations: ids.filter((id) => !given.has(id)),
    retrieval,
    model: input.model.ref,
    promptVersion: input.prompt.version,
    latencyMs: Math.round(performance.now() - started),
    inputTokens: response.usage.inputTokens,
    outputTokens: response.usage.outputTokens,
  };
}
