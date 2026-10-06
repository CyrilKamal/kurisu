import { mentionsWholeBrief } from "../../src/agent/briefReply.js";
import { parseBriefText } from "../../src/brief/build.js";
import type { TitleIndex } from "./snapshot.js";

/**
 * The morning brief a case replies to, when its history ends with one written the way the app
 * writes briefs (see brief/build.ts chatText). The app gets this from the briefs table; a case
 * only has the text, so the titles are looked up in the snapshot.
 */
export function briefFromHistory(
  history: { role: "user" | "assistant"; content: string }[],
  index: TitleIndex,
): { malId: number; lastEpisode: number }[] | null {
  const last = history.at(-1);
  if (last?.role !== "assistant") return null;
  const items = parseBriefText(last.content).flatMap(({ title, lastEpisode }) => {
    const found = index.resolve(title);
    return found.ok ? [{ malId: found.entry.id, lastEpisode }] : [];
  });
  return items.length > 0 ? items : null;
}

/**
 * For a "watched it" reply to a brief: the last episode the brief listed per show. Null when the
 * case isn't such a reply.
 */
export function briefReplyEpisodes(
  message: string,
  history: { role: "user" | "assistant"; content: string }[],
  index: TitleIndex,
): Map<number, number> | null {
  const brief = briefFromHistory(history, index);
  if (!brief || !mentionsWholeBrief(message)) return null;
  return new Map(brief.map((item) => [item.malId, item.lastEpisode]));
}
