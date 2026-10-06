const MAX_TITLE_CHARS = 60;

/** A chat's title from its first message: one line, cut at a word boundary near 60 characters. */
export function titleFrom(text: string): string {
  const line = text.replace(/\s+/g, " ").trim();
  if (line.length <= MAX_TITLE_CHARS) return line;
  const cut = line.slice(0, MAX_TITLE_CHARS - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > MAX_TITLE_CHARS / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/** The longest name a user can give a chat; mirrored in @kurisu/shared. */
export const CHAT_TITLE_MAX = 100;

/** What a chat with no title and no message of the user's is called. */
export const UNTITLED_CHAT = "New chat";
