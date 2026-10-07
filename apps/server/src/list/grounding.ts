import { normalizeName, seasonMarkers, type SeasonRef } from "./seasons.js";

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
