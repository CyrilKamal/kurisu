import { shortId } from "@kurisu/shared";

/**
 * A reply's tool calls in a few words each, for its trace in Chat (the design system's LogEntry:
 * `search_my_list  "tidewater" → 1 match  92ms`). From what agent_run_steps logged.
 */

const MAX_ARGS = 80;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function shortValue(value: unknown): string | null {
  if (typeof value === "string") return UUID.test(value) ? shortId(value) : value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value) && value.every((v) => typeof v === "string" || typeof v === "number"))
    return value.join(",");
  return null;
}

function clip(text: string): string {
  return text.length <= MAX_ARGS ? text : `${text.slice(0, MAX_ARGS - 1)}…`;
}

/** `"tidewater" +2`, `#5114 status=completed`, `p_7f3a`, or `airing_now=true services=netflix`. */
export function stepArgs(args: unknown): string {
  if (!isRecord(args)) return "";
  const { queries, query, anime_id: animeId, proposal_id: proposalId, ...rest } = args;
  const parts: string[] = [];
  const words = Array.isArray(queries)
    ? queries.filter((q) => typeof q === "string")
    : typeof query === "string"
      ? [query]
      : [];
  if (words.length > 0) {
    parts.push(`"${words[0] ?? ""}"${words.length > 1 ? ` +${String(words.length - 1)}` : ""}`);
  }
  if (typeof animeId === "number") parts.push(`#${String(animeId)}`);
  if (typeof proposalId === "string") parts.push(shortId(proposalId));
  for (const [key, value] of Object.entries(rest)) {
    const shown = shortValue(value);
    if (shown !== null && shown !== "") parts.push(`${key}=${shown}`);
  }
  return clip(parts.join(" "));
}

const STATUS_WORDS: Record<string, string> = {
  committed: "written",
  handed_off: "handed to the recommender",
  waiting_for_user_confirmation: "waits for your OK",
};

/** What a call returned: "1 match", "written", "p_7f3a held", or its error code. */
export function stepResult(result: unknown, error: string | null): { text: string; ok: boolean } {
  if (error) return { text: error, ok: false };
  if (!isRecord(result)) return { text: "ok", ok: true };
  if (typeof result.error === "string") return { text: result.error, ok: false };
  if (result.truncated === true) return { text: "ok", ok: true };
  if (Array.isArray(result.results)) {
    const n = result.results.length;
    return { text: n === 0 ? "no match" : `${String(n)} match${n === 1 ? "" : "es"}`, ok: true };
  }
  if (Array.isArray(result.candidates)) {
    const n = result.candidates.length;
    return { text: `${String(n)} candidate${n === 1 ? "" : "s"}`, ok: true };
  }
  if (typeof result.proposal_id === "string") {
    const id = shortId(result.proposal_id);
    return { text: result.requires_confirmation === true ? `${id} held` : id, ok: true };
  }
  if (typeof result.status === "string") {
    if (result.status === "shown" && typeof result.picks === "number") {
      return {
        text: `${String(result.picks)} pick${result.picks === 1 ? "" : "s"} shown`,
        ok: true,
      };
    }
    return { text: STATUS_WORDS[result.status] ?? result.status.replaceAll("_", " "), ok: true };
  }
  if (typeof result.title === "string") return { text: clip(result.title), ok: true };
  return { text: "ok", ok: true };
}
