/**
 * Replies to the morning brief that mean "caught up on everything in it" (the user's decision,
 * 2026-10-06): "watched it", "watched them all", "saw both", "caught up", "done with all of them".
 * A message naming a show ("watched frieren") isn't one of these.
 */
const WHOLE_BRIEF =
  /\b(?:watched|saw|seen|finished|done with|caught up on)\s+(?:it|them|those|these|'?em|both|all|everything)\b|\b(?:all\s+)?caught up\b(?!\s+(?:on|with)\b)/i;

export function mentionsWholeBrief(message: string): boolean {
  return WHOLE_BRIEF.test(message);
}
