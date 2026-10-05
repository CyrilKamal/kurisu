/**
 * Detects replies that tell the user their list changed. The chat service uses it to catch a
 * reply claiming an update when the run committed nothing (a model can pattern-match an
 * earlier "Updated ..." reply without calling any tools). Deliberately broad: a false positive
 * only swaps in an honest "nothing changed" message. Negated forms ("could not be updated",
 * "wasn't marked", "nothing changed") are an honest failure, not a claim, so they don't count.
 */
const CLAIM_VERB = String.raw`updated|updating|marked|moved|changed|bumped|logged|recorded|set (?:it|that|them|the \w+) to`;

const CLAIM = new RegExp(String.raw`\b(?:${CLAIM_VERB}|(?:is|are) now|now (?:on|at))\b`, "i");

/**
 * A negation right before a claim verb, with only small words between ("couldn't be updated",
 * "hasn't been marked", "wasn't able to get it updated"). Kept tight so "Not a problem, I've
 * updated it" still reads as a claim.
 */
const NEGATED_CLAIM = new RegExp(
  String.raw`(?:\b(?:not|never|nothing|cannot|unable|failed)|n['’]t)\s+(?:(?:be|been|being|get|got|was|were|has|have|is|are|it|that|them|this|yet|able|to)\s+){0,4}(?:${CLAIM_VERB})\b`,
  "gi",
);

export function claimsChange(reply: string): boolean {
  return CLAIM.test(reply.replace(NEGATED_CLAIM, " "));
}

export const NOTHING_CHANGED_REPLY =
  "I didn't change anything on your list. Tell me the show and episode again and I'll update it.";
