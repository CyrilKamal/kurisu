/** The longest diary note kept, in characters. */
export const MAX_NOTE = 500;

function squash(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * What a diary note says: the user's own words, never the model's. The model passes the part of
 * the message that's about the show ("that finale was insane"); it's kept only if it appears in
 * the message word for word (case and spacing aside), and otherwise the whole message is kept.
 */
export function reactionWords(message: string, quote: string): string {
  const said = squash(message);
  const wanted = squash(quote).replace(/^["'“‘]+|["'”’]+$/g, "");
  const at = wanted.length > 0 ? said.toLowerCase().indexOf(wanted.toLowerCase()) : -1;
  const words = at >= 0 ? said.slice(at, at + wanted.length) : said;
  return words.slice(0, MAX_NOTE);
}
