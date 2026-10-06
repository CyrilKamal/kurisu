import { mentionsNumber } from "./scoreGiven.js";

/**
 * How a reply right after the morning brief pins down episode numbers (the user's rules,
 * 2026-10-06). Each rule only covers shows the brief listed:
 *
 * - "watched it", "watched them all", "done", "finished", "caught up", "saw them": caught up on
 *   everything, so each show goes to the last episode listed for it.
 * - A show named without a number ("watched wistoria"): caught up on that show, the same way.
 * - An episode number ("ep 8", "the 2nd ep", "the first ep", "the premiere"): that episode, for
 *   the show the brief listed it for.
 * - A count ("a wistoria ep", "one ep", "3 clevatess"): more episodes, up to the last one listed.
 * - "haven't seen them", "didn't watch any yet": no progress at all.
 */
export type BriefRule =
  { kind: "last" } | { kind: "exact"; episode: number } | { kind: "upTo" } | { kind: "none" };

const WHOLE_BRIEF = new RegExp(
  [
    // "watched it", "saw them", "finished both", "done with all of them", "caught up on them"
    String.raw`\b(?:watched|saw|seen|finished|done with|caught up on)\s+(?:it|them|those|these|'?em|both|all|everything)\b`,
    // "watched the eps", "finished the show", "saw the new ones"
    String.raw`\b(?:watched|saw|seen|finished)\s+the\s+(?:eps|episodes|new ones|new eps|ones|show|shows)\b`,
    // "caught up", "all caught up", but not "caught up on frieren"
    String.raw`\b(?:all\s+)?caught up\b(?!\s+(?:on|with)\b)`,
    // a bare "done" or "finished"
    String.raw`^\s*(?:all\s+|ok\s+|okay\s+)?(?:done|finished)\s*[.!]*\s*$`,
  ].join("|"),
  "i",
);

/** "haven't seen them", "didn't watch any yet", "not caught up" */
const NOT_WATCHED =
  /\b(?:haven'?t|have not|hasn'?t|didn'?t|did not|not|never)\s+(?:\w+\s+)?(?:watch(?:ed)?|seen|see|caught|finished|started)\b/i;

const ORDINALS: Record<string, number> = {
  first: 1,
  second: 2,
  third: 3,
  fourth: 4,
  fifth: 5,
  sixth: 6,
  seventh: 7,
  eighth: 8,
  ninth: 9,
  tenth: 10,
};

/** "a wistoria ep", "one episode", "an ep" */
const ONE_EPISODE = /\b(?:a|an|one|single)\s+(?:\S+\s+)?(?:ep|eps|episode|episodes)\b/i;

export function mentionsWholeBrief(message: string): boolean {
  return WHOLE_BRIEF.test(message);
}

/** The episode a message names: "ep 8", "episode 3", "the 2nd ep", "the first episode", "the premiere". */
export function namedEpisode(message: string): number | null {
  const byNumber = /\b(?:ep|episode)\s*#?(\d+)\b/i.exec(message);
  if (byNumber?.[1]) return Number(byNumber[1]);
  const byOrdinal = /\b(\d+)(?:st|nd|rd|th)\s+(?:ep|episode)\b/i.exec(message);
  if (byOrdinal?.[1]) return Number(byOrdinal[1]);
  const byWord =
    /\b(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)\s+(?:ep|episode)\b/i.exec(
      message,
    );
  if (byWord?.[1]) return ORDINALS[byWord[1].toLowerCase()] ?? null;
  if (/\bpremiere\b/i.test(message)) return 1;
  return null;
}

/** Which rule a reply to the brief follows (see BriefRule). */
export function briefRule(message: string): BriefRule {
  if (NOT_WATCHED.test(message) && !mentionsWholeBrief(message.replace(NOT_WATCHED, ""))) {
    return { kind: "none" };
  }
  const episode = namedEpisode(message);
  if (episode !== null) return { kind: "exact", episode };
  if (mentionsWholeBrief(message)) return { kind: "last" };
  if (mentionsNumber(message) || ONE_EPISODE.test(message)) return { kind: "upTo" };
  return { kind: "last" };
}

/**
 * Whether progress to `next` episodes fits a reply to the brief, for a show the brief listed
 * `listed` (ascending) for, from `current`.
 */
export function briefAllows(
  rule: BriefRule,
  listed: readonly number[],
  current: number,
  next: number | undefined,
): boolean {
  const last = listed.at(-1);
  if (next === undefined || last === undefined) return false;
  switch (rule.kind) {
    case "none":
      return false;
    case "last":
      return next === last;
    case "exact":
      return next === rule.episode && listed.includes(rule.episode);
    case "upTo":
      return next > current && next <= last;
  }
}
