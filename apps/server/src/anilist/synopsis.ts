/** How long a show's page waits for AniList before it opens without the synopsis. */
export const SYNOPSIS_WAIT_MS = 4_000;

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  mdash: "—",
  ndash: "–",
  hellip: "…",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
};

/**
 * AniList's description as plain text: line breaks kept, tags and spoilers (AniList's `~!…!~`)
 * removed, entities decoded, and runs of blank lines folded into one.
 */
export function plainSynopsis(raw: string): string {
  const text = raw
    .replace(/~![\s\S]*?!~/g, "")
    // AniList follows a <br> with a newline of its own: one break, not two.
    .replace(/<br\s*\/?>\r?\n?/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, name: string) => {
      if (name.startsWith("#x") || name.startsWith("#X")) {
        return String.fromCodePoint(Number.parseInt(name.slice(2), 16));
      }
      if (name.startsWith("#")) return String.fromCodePoint(Number.parseInt(name.slice(1), 10));
      return ENTITIES[name.toLowerCase()] ?? match;
    });
  return text
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
