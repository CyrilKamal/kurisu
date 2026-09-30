/**
 * Detects replies that tell the user their list changed. The chat service uses it to catch a
 * reply claiming an update when the run committed nothing (a model can pattern-match an
 * earlier "Updated ..." reply without calling any tools). Deliberately broad: a false positive
 * only swaps in an honest "nothing changed" message.
 */
const CLAIM =
  /\b(updated|updating|marked|moved|changed|bumped|logged|recorded|set (?:it|that|them|the \w+) to|(?:is|are) now|now (?:on|at))\b/i;

export function claimsChange(reply: string): boolean {
  return CLAIM.test(reply);
}

export const NOTHING_CHANGED_REPLY =
  "I didn't change anything on your list. Tell me the show and episode again and I'll update it.";
