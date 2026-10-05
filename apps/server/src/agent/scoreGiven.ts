const NUMBER = /\b(?:\d+(?:\.\d+)?|zero|one|two|three|four|five|six|seven|eight|nine|ten)\b/i;

/**
 * Whether the user's message could contain a score: any number, as digits or a word ("Death
 * Note is a 10", "an eight"). A score proposed from a message without one was invented ("that
 * was so good" isn't a 10), so it's held for the user to confirm.
 */
export function mentionsNumber(message: string): boolean {
  return NUMBER.test(message);
}
