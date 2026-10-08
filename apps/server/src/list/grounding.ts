import { isSeasonWord, normalizeName, seasonMarkers, type SeasonRef } from "./seasons.js";

/**
 * Everyday words that could be a title's initials. A message saying "the" or "lol" isn't naming
 * a show called "The Hidden Enemy" or "Lord of Leftovers".
 */
const COMMON_WORDS = new Set(
  (
    "the and but for nor yet not are was were has had have did does got get let put say see saw " +
    "all any its his her him she they them you your our out off own who why how now new old one " +
    "two too way may can will just also only more some then than that this what when with from " +
    "been very much back over lol omg idk tbh imo btw ngl wtf yes"
  ).split(" "),
);

const ARTICLES = new Set(["the", "a", "an"]);

/** Titles of at least this many words can be named by their initials ("ylia", "mha", "cote"). */
const MIN_INITIALS = 3;

/** Up to this many of a name's words, run together, also count as one word (see wordsInName). */
const MAX_JOINED = 3;

/**
 * A word spelled this close to a word of the name counts as that word: trigram similarity, as
 * pg_trgm computes it. "kabeneri"/"kabaneri" is 0.50 and "frieran"/"frieren" 0.45, while
 * "perfect"/"period" is 0.25 and "hoyuka"/"hyouka" 0.27.
 */
const CLOSE_SPELLING = 0.45;

/**
 * Whether every word of a title as written is in this name, season words aside ("jjk s2" in
 * "JJK"). A fuzzy score alone isn't enough: "perfect blue" scores well against "Blue Period", but
 * "perfect" isn't in that name. A nickname that's part of the name ("frieren", "kusuriya")
 * passes, and so does a close spelling of one of its words ("Gangster" for "Gangsta.").
 * Punctuation splits a name's words, so a word may also be a few of them run together ("rezero"
 * for "Re:Zero", "jojos" for "JoJo's"). A title of season words only ("86") needs all of them.
 */
export function wordsInName(title: string, name: string): boolean {
  const words = normalizeName(name).split(" ");
  const nameWords = new Set<string>();
  for (let i = 0; i < words.length; i++) {
    for (let k = 1; k <= MAX_JOINED && i + k <= words.length; k++) {
      nameWords.add(words.slice(i, i + k).join(""));
    }
  }
  const written = normalizeName(title)
    .split(" ")
    .filter((word) => word.length > 0);
  const showWords = written.filter((word) => !isSeasonWord(word));
  return (showWords.length > 0 ? showWords : written).every(
    (word) =>
      nameWords.has(word) ||
      [...nameWords].some((nameWord) => wordSimilarity(word, nameWord) >= CLOSE_SPELLING),
  );
}

/** pg_trgm's similarity for two single words: shared trigrams over all trigrams. */
function wordSimilarity(a: string, b: string): number {
  const trigrams = (word: string) => {
    const padded = `  ${word} `;
    const found = new Set<string>();
    for (let i = 0; i + 3 <= padded.length; i++) found.add(padded.slice(i, i + 3));
    return found;
  };
  const ta = trigrams(a);
  const tb = trigrams(b);
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  return shared / (ta.size + tb.size - shared);
}

/**
 * The user's own words in one agent run: their message, their earlier messages in the chat, and
 * a brief's titles when they reply to it. A title the model supplied only makes a show clear when
 * these name the show (see markClear in search.ts).
 */
export interface UsersWords {
  /**
   * Whether one of the messages names a show by this name: the whole name as consecutive words,
   * or its initials as one word ("ylia" for "Your Lie in April", ignoring a leading "The"). With
   * `season`, that message must also give that season and part number in so many words ("s4").
   */
  names(name: string, season?: SeasonRef): boolean;
  /**
   * Whether every word of a search query is in one of the messages, in any order: the user's own
   * words rearranged ("isekai chronicles season 2" for "season 2 of isekai chronicles"), with
   * nothing the model added ("soul eater" for "the eater one").
   */
  says(query: string): boolean;
}

export function usersWords(texts: string[]): UsersWords {
  // Each message on its own, so a name can't be pieced together from two of them.
  const messages = texts.map((text) => {
    const said = normalizeName(text);
    const words = said.split(" ");
    return {
      said: ` ${said} `,
      words: new Set(words),
      initials: new Set(words.filter((w) => w.length >= MIN_INITIALS && !COMMON_WORDS.has(w))),
      markers: seasonMarkers(text),
    };
  });
  return {
    names(name, season) {
      const n = normalizeName(name);
      if (!n) return false;
      const words = n.split(" ");
      const core = words[0] && ARTICLES.has(words[0]) ? words.slice(1) : words;
      const initials = core.length >= MIN_INITIALS ? core.map((w) => w.charAt(0)).join("") : null;
      return messages.some(
        (m) =>
          (m.said.includes(` ${n} `) || (initials !== null && m.initials.has(initials))) &&
          (season === undefined ||
            ((season.season === null || m.markers.seasons.has(season.season)) &&
              (season.part === null || m.markers.parts.has(season.part)))),
      );
    },
    says(query) {
      const words = normalizeName(query).split(" ");
      return messages.some((m) => words.every((w) => w !== "" && m.words.has(w)));
    },
  };
}
