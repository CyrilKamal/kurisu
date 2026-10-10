import { z } from "zod";

import type { ModelClient } from "../../src/llm/modelClient.js";
import type { ModelRef } from "../../src/llm/modelConfig.js";
import type { ToolSpec } from "../../src/llm/types.js";

/**
 * The RAG eval's judge: reads an answer next to the documents it cites and grades it, with one
 * tool call. A judge model is fallible, so the report keeps every grade for reading. Bump the
 * version for any change; each report records it.
 */
export const RAG_JUDGE = {
  version: "rag-judge@1",
  system: `You grade an answer to a question a user asked about their own anime list. You get the question, the facts a right answer states (if any), the answer, and the documents it cites, each starting with its id in square brackets. "I", "me" and "my" in the documents are the user; the answer calls them "you".

Call grade once:
- facts: for each fact listed, whether the answer states it, in any words. A fact the answer leaves out or contradicts isn't stated.
- claims: each separate thing the answer says about a show or about the user's list, in a few words, and whether the cited documents say it. A claim the cited documents don't say is unsupported, even if it's true. Saying the list can't answer, or that a show isn't on it, isn't a claim.
- declined: whether the answer says the list can't answer the question, or that the show asked about isn't on it.`,
} as const;

const GRADE_TOOL: ToolSpec = {
  name: "grade",
  description: "Report the grade of the answer.",
  parameters: {
    type: "object",
    properties: {
      facts: {
        type: "array",
        items: {
          type: "object",
          properties: { fact: { type: "string" }, stated: { type: "boolean" } },
          required: ["fact", "stated"],
        },
      },
      claims: {
        type: "array",
        items: {
          type: "object",
          properties: { claim: { type: "string" }, supported: { type: "boolean" } },
          required: ["claim", "supported"],
        },
      },
      declined: { type: "boolean" },
    },
    required: ["facts", "claims", "declined"],
  },
};

const gradeSchema = z.object({
  facts: z.array(z.object({ fact: z.string(), stated: z.boolean() })).default([]),
  claims: z.array(z.object({ claim: z.string(), supported: z.boolean() })).default([]),
  declined: z.boolean(),
});
export type Grade = z.infer<typeof gradeSchema>;

export interface JudgeResult {
  grade: Grade | null;
  error: string | null;
  inputTokens: number;
  outputTokens: number;
}

/** Grades one answer. Tries twice before giving up on a judge that doesn't call grade. */
export async function judgeAnswer(
  models: ModelClient,
  model: ModelRef,
  input: {
    question: string;
    facts: string[];
    answer: string;
    cited: { id: number; text: string }[];
  },
): Promise<JudgeResult> {
  const content = [
    `Question: ${input.question}`,
    input.facts.length > 0
      ? `Facts a right answer states:\n${input.facts.map((f) => `- ${f}`).join("\n")}`
      : "Facts a right answer states: (none listed)",
    `Answer: ${input.answer}`,
    input.cited.length > 0
      ? `Documents it cites:\n\n${input.cited.map((d) => `[${String(d.id)}] ${d.text}`).join("\n\n")}`
      : "Documents it cites: (none)",
  ].join("\n\n");
  let inputTokens = 0;
  let outputTokens = 0;
  let error = "the judge didn't call grade";
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await models.chat(model, {
      system: RAG_JUDGE.system,
      messages: [{ role: "user", content }],
      tools: [GRADE_TOOL],
    });
    inputTokens += response.usage.inputTokens;
    outputTokens += response.usage.outputTokens;
    const call = response.toolCalls.find((c) => c.name === "grade");
    if (!call) continue;
    const parsed = gradeSchema.safeParse(call.arguments);
    if (parsed.success) return { grade: parsed.data, error: null, inputTokens, outputTokens };
    error = `the judge's grade didn't parse: ${parsed.error.issues[0]?.message ?? "?"}`;
  }
  return { grade: null, error, inputTokens, outputTokens };
}
