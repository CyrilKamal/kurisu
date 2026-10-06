import {
  briefRule,
  mentionsWholeBrief,
  namedShows,
  onlyNamedShows,
  type BriefRule,
} from "../../src/agent/briefReply.js";
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
): { malId: number; episodes: number[] }[] | null {
  const last = history.at(-1);
  if (last?.role !== "assistant") return null;
  const items = parseBriefText(last.content).flatMap(({ title, episodes }) => {
    const found = index.resolve(title);
    return found.ok ? [{ malId: found.entry.id, episodes }] : [];
  });
  return items.length > 0 ? items : null;
}

/**
 * How a case's message replies to the brief in its history, the way the agent's tools decide it:
 * the episodes listed per show, the rule the message follows, and whether it claims the whole
 * brief. Null when the history doesn't end with a brief.
 */
export function briefReplyFor(
  message: string,
  history: { role: "user" | "assistant"; content: string }[],
  index: TitleIndex,
): {
  listed: Map<number, number[]>;
  rule: BriefRule;
  whole: boolean;
  /** Shows the rule doesn't cover because the reply names others ("watched daemons and clevatess"). */
  unnamed: Set<number>;
} | null {
  const brief = briefFromHistory(history, index);
  if (!brief) return null;
  const rule = briefRule(message);
  const shows = brief.flatMap((item) => {
    const found = index.resolve(String(item.malId));
    if (!found.ok) return [];
    const e = found.entry;
    const names = [e.title, e.titleEn, e.titleJa, ...e.synonyms].filter((n): n is string => !!n);
    return [{ malId: item.malId, names }];
  });
  const named = namedShows(message, shows);
  const unnamed = new Set(
    onlyNamedShows(message, rule) && named.size > 0
      ? brief.map((item) => item.malId).filter((id) => !named.has(id))
      : [],
  );
  return {
    listed: new Map(brief.map((item) => [item.malId, item.episodes])),
    rule,
    whole: mentionsWholeBrief(message),
    unnamed,
  };
}
