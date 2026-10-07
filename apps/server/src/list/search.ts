import { and, eq, sql } from "drizzle-orm";

import type { Db } from "../db/client.js";
import { anime, listEntries } from "../db/schema.js";
import { NOT_YET_AIRED } from "../mal/client.js";
import type { ListStatus } from "../writes/normalize.js";
import { usersWords, type UsersWords } from "./grounding.js";
import { matchesSeason, normalizeName, seasonRef, type SeasonRef } from "./seasons.js";

/** Below this, a name isn't considered a match at all. */
export const MIN_MATCH = 0.35;
/** A clear match needs at least this score... */
export const CLEAR_MATCH = 0.6;
/** ...and must beat every other candidate by this much. */
export const CLEAR_MARGIN = 0.15;
/**
 * The best a name can score without being the query exactly. "Another" inside "...in Another
 * World" is a full word match, but it mustn't tie with the show called "Another".
 */
export const PARTIAL_MATCH_CAP = 0.95;
/** How many entries the clear-match rule looks at, so a hidden rival can't make one look unique. */
const POOL_SIZE = 20;

export interface ListEntryView {
  animeId: number;
  title: string;
  titleEn: string | null;
  mediaType: string | null;
  numEpisodes: number | null;
  status: ListStatus;
  episodesWatched: number;
  score: number;
  isRewatching: boolean;
  /** MAL's airing status: finished_airing, currently_airing or not_yet_aired. */
  airingStatus: string | null;
}

/**
 * A search result. `S` is the list status: always set for a search of the list, null for a show
 * found outside it (see searchCatalog).
 */
export interface SearchCandidate<S extends ListStatus | null = ListStatus> extends Omit<
  ListEntryView,
  "status"
> {
  status: S;
  /** 0–1: best trigram similarity between any query and any of the show's names. */
  matchScore: number;
  /** The name that matched best (title, English, Japanese or a synonym). */
  matchedName: string;
  /** True if the words point at this show clearly enough for some change (see clearBy). */
  clear: boolean;
  /**
   * Why it's clear:
   * - "unique": the only show the words point at. Clear for any change.
   * - "only_in_progress": tied with other seasons, but the only one being watched, on hold or
   *   rewatched (e.g. "frieren ep 5" with season 1 completed and season 2 watching). Clear only for
   *   forward progress; dropping or scoring "the isekai one" among several must still ask.
   *   A show that hasn't aired yet isn't in progress, even if the list says watching.
   */
  clearBy: ClearBy | null;
}

export type ClearBy = "unique" | "only_in_progress";

/** An entry on the list or found outside it; the clear-match helpers work on either. */
type AnyEntry = ScoredEntry<ListStatus | null>;

/** An entry with its score against each query, as the clear-match rule needs it. */
export interface ScoredEntry<S extends ListStatus | null = ListStatus> extends Omit<
  SearchCandidate<S>,
  "clear" | "clearBy"
> {
  /** Every name the show has: title, English, Japanese and synonyms. */
  names: string[];
  /** Best score per query, in query order. */
  scores: number[];
  /** Whether one of the show's names is exactly the query, per query. */
  exact: boolean[];
}

interface SearchOptions {
  limit?: number;
  /**
   * A series' own movies and specials don't stop its exact name from being clear. For searches
   * outside the list, where every franchise brings its side stories along; on the list, the
   * user put each entry there.
   */
  sideStoriesDontCount?: boolean;
  /** The user's message, so titles the model supplied can be told from the user's words. */
  userText?: string;
  /**
   * All of the user's own words in this run, one message per item: this message, their earlier
   * messages in the chat and a brief's titles. A title the model supplied only makes a show clear
   * when these name it (see markClear).
   */
  groundIn?: string[];
  /** Entries some search left tied, kept across the searches of one agent run. */
  contested?: Set<number>;
  /** The user is answering the agent's question, so naming an entry exactly picks it. */
  answering?: boolean;
}

/**
 * Fuzzy search over the user's mirrored list (never live MAL). Scores every name a show has
 * against every query with pg_trgm. Each query is judged on its own, so one search can carry
 * title variants ("jjk", "Jujutsu Kaisen") or several shows ("World Trigger", "One Piece").
 */
export async function searchMyList(
  db: Db,
  userId: string,
  queries: string[],
  options: SearchOptions = {},
): Promise<SearchCandidate[]> {
  const cleaned = cleanQueries(queries);
  if (cleaned.length === 0) return [];
  const pool = (await scoredPool(db, userId, null, cleaned)).filter(
    (e): e is ScoredEntry => e.status !== null,
  );
  return clearFirst(markClear(pool, cleaned, options), options.limit);
}

/**
 * The same search over shows found outside the list (their `anime` rows must exist), with the
 * same clear-match rule. A show the user has on their list comes back with its list status.
 */
export async function searchCatalog(
  db: Db,
  userId: string,
  animeIds: number[],
  queries: string[],
  options: SearchOptions = {},
): Promise<SearchCandidate<ListStatus | null>[]> {
  const cleaned = cleanQueries(queries);
  if (cleaned.length === 0 || animeIds.length === 0) return [];
  const pool = await scoredPool(db, userId, animeIds, cleaned);
  return clearFirst(
    markClear(pool, cleaned, { ...options, sideStoriesDontCount: true }),
    options.limit,
  );
}

function cleanQueries(queries: string[]): string[] {
  return [...new Set(queries.map(normalizeName).filter((q) => q))];
}

/** Clear matches first, so the model always sees them, then the best of the rest. */
function clearFirst<C extends { clear: boolean }>(marked: C[], limit = 5): C[] {
  return [...marked.filter((c) => c.clear), ...marked.filter((c) => !c.clear)].slice(0, limit);
}

/**
 * Scores the shows on the user's list (animeIds null), or these shows wherever they are, against
 * each query.
 */
async function scoredPool(
  db: Db,
  userId: string,
  animeIds: number[] | null,
  cleaned: string[],
): Promise<ScoredEntry<ListStatus | null>[]> {
  // Drizzle spreads a JS array into separate parameters, so build the Postgres arrays explicitly.
  const queryArray = sql`ARRAY[${sql.join(
    cleaned.map((q) => sql`${q}`),
    sql`, `,
  )}]::text[]`;
  // Exact (after dropping case and punctuation, as normalizeName does) scores 1; anything else is
  // capped just below it.
  const score = sql`CASE
      WHEN trim(regexp_replace(lower(n.name), '[^[:alnum:]]+', ' ', 'g')) = q.q THEN 1.0
      ELSE LEAST(${PARTIAL_MATCH_CAP},
                 GREATEST(similarity(lower(n.name), q.q), word_similarity(q.q, lower(n.name))))
    END::float8`;
  const names = sql`array_remove(ARRAY[a.title, a.title_en, a.title_ja] || a.synonyms, NULL)`;
  const from =
    animeIds === null
      ? sql`FROM ${listEntries} le JOIN ${anime} a ON a.mal_id = le.anime_id`
      : sql`FROM ${anime} a
            LEFT JOIN ${listEntries} le ON le.anime_id = a.mal_id AND le.user_id = ${userId}`;
  const scope =
    animeIds === null
      ? sql`le.user_id = ${userId}`
      : sql`a.mal_id IN (${sql.join(
          animeIds.map((id) => sql`${id}`),
          sql`, `,
        )})`;

  const rows = await db.execute<{
    anime_id: number;
    title: string;
    title_en: string | null;
    media_type: string | null;
    num_episodes: number | null;
    status: ListStatus | null;
    episodes_watched: number | null;
    score: number | null;
    is_rewatching: boolean | null;
    airing_status: string | null;
    names: string[];
    scores: number[];
    exact: boolean[];
    match_score: number;
    matched_name: string;
  }>(sql`
    SELECT a.mal_id AS anime_id, a.title, a.title_en, a.media_type, a.num_episodes,
           le.status, le.num_episodes_watched AS episodes_watched, le.score, le.is_rewatching,
           a.airing_status, ${names} AS names, per.scores, per.exact,
           best.score AS match_score, best.name AS matched_name
    ${from}
    CROSS JOIN LATERAL (
      SELECT n.name, ${score} AS score
      FROM unnest(${names}) AS n(name)
      CROSS JOIN unnest(${queryArray}) AS q(q)
      ORDER BY score DESC
      LIMIT 1
    ) best
    CROSS JOIN LATERAL (
      SELECT array_agg(s.score ORDER BY s.qi) AS scores, array_agg(s.exact ORDER BY s.qi) AS exact
      FROM (
        SELECT q.qi, MAX(${score}) AS score,
               BOOL_OR(trim(regexp_replace(lower(n.name), '[^[:alnum:]]+', ' ', 'g')) = q.q) AS exact
        FROM unnest(${names}) AS n(name)
        CROSS JOIN unnest(${queryArray}) WITH ORDINALITY AS q(q, qi)
        GROUP BY q.qi
      ) s
    ) per
    WHERE ${scope} AND best.score >= ${MIN_MATCH}
    ORDER BY best.score DESC, a.mal_id
    LIMIT ${POOL_SIZE}
  `);

  return rows.rows.map((row) => ({
    animeId: row.anime_id,
    title: row.title,
    titleEn: row.title_en,
    mediaType: row.media_type,
    numEpisodes: row.num_episodes,
    status: row.status,
    episodesWatched: row.episodes_watched ?? 0,
    score: row.score ?? 0,
    isRewatching: row.is_rewatching ?? false,
    airingStatus: row.airing_status,
    matchScore: Math.round(row.match_score * 1000) / 1000,
    matchedName: row.matched_name,
    names: row.names,
    scores: row.scores.map(Number),
    exact: row.exact,
  }));
}

/**
 * The clear-match rule, applied to each query on its own. For one query, among the entries
 * within CLEAR_MARGIN of the best (which must reach CLEAR_MATCH):
 * 1. A single entry with exactly that name is clear, unless other seasons' titles start with it
 *    ("Bungou Stray Dogs" is also the start of "Bungou Stray Dogs 4th Season"). When the user
 *    is answering "which one?", naming an entry exactly settles it anyway.
 * 2. A season or part number in the query ("danmachi 4th season", "tog s2") keeps only the
 *    entries that are that season. If none is, and the franchise numbers its seasons, the
 *    season isn't on the list, so nothing is clear. Franchises that name seasons after arcs
 *    ("Imperial Wrath of the Gods") can't be checked this way, so the number is ignored.
 * 3. If one entry is left, it's clear. If several seasons of one franchise are left, the only
 *    one in progress is clear for forward progress. Different shows that share a word ("blue"
 *    in Blue Lock and Grand Blue, "the isekai one") stay unclear.
 * An entry is clear if any query makes it clear; "unique" beats "only_in_progress".
 *
 * A tie stays a tie. When a query leaves several entries tied ("blue": Blue Lock and Grand
 * Blue; "Tower of God Season 2": its two Season 2 entries), only the user's own words can pick
 * one of them later, not a title the model supplied ("Blue Lock", or one entry's exact name):
 * choosing is the user's call. With the user's message (userText), queries that appear in it are
 * the user's words; the rest are the model's. Model-supplied titles still decode nicknames that
 * tie with nothing ("omp 3" -> "One Punch Man 3"). Pass the same contested set to every search
 * of a run, so a later search can't settle a tie either. If the model's own titles point at two
 * different seasons of one franchise, both are contested too: it's guessing between them. And
 * a search with none of the user's words in it is all guesses, so only an entry's exact name
 * makes it clear there.
 *
 * A title the model supplied must also be grounded in the user's own words (groundIn): it's only
 * their words rearranged, or they name the show, or another season of it and the code picks this
 * one (see grounded). The model reading "the eater one" as "Soul Eater" is its guess, not the
 * user's words, so it waits for them.
 */
export function markClear<S extends ListStatus | null>(
  pool: ScoredEntry<S>[],
  queries: string[],
  context: {
    userText?: string;
    groundIn?: string[];
    contested?: Set<number>;
    answering?: boolean;
    sideStoriesDontCount?: boolean;
  } = {},
): SearchCandidate<S>[] {
  const said = context.userText === undefined ? null : ` ${normalizeName(context.userText)} `;
  const isUsersWords = (query: string) => said?.includes(` ${query} `) ?? false;

  const verdicts = queries.map((query, qi) => ({
    query,
    contenders: contendersFor(pool, qi),
    found: clearForQuery(
      pool,
      qi,
      query,
      context.answering === true && isUsersWords(query),
      context.sideStoriesDontCount === true,
    ),
  }));
  // Every entry a query tied without picking it is contested, when the tie means something: it's
  // in the user's own words ("blue"), or between seasons of one show ("Tower of God Season 2").
  // A vague title from the model that happens to match different shows ("mha final season" also
  // fits Attack on Titan's Final Season) says nothing about them.
  const contested = context.contested ?? new Set<number>();
  for (const { query, contenders, found } of verdicts) {
    if (contenders.length < 2) continue;
    const oneShow = contenders.every((e) =>
      contenders.every((f) => e === f || seasonsOfOneShow(e, f)),
    );
    if (!isUsersWords(query) && !oneShow) continue;
    for (const e of contenders) if (e.animeId !== found?.id) contested.add(e.animeId);
  }
  // Titles the model supplied that point at different seasons of one franchise ("My Hero
  // Academia Final Season" and "mha season 7") are the model guessing between them.
  const modelPicks = [
    ...new Set(
      verdicts.filter((v) => v.found && !isUsersWords(v.query)).map((v) => v.found?.id ?? 0),
    ),
  ].map((id) => pool.find((e) => e.animeId === id));
  for (const [i, a] of modelPicks.entries()) {
    for (const b of modelPicks.slice(i + 1)) {
      if (a && b && seasonsOfOneShow(a, b)) {
        contested.add(a.animeId);
        contested.add(b.animeId);
      }
    }
  }

  // With none of the user's words in this search, the model's titles are all guesses: only an
  // entry's exact name counts (that's how nicknames decode), not a fuzzy match or a tie-break.
  // Their words in another order ("isekai chronicles season 2") are still theirs.
  const words = context.groundIn === undefined ? null : usersWords(context.groundIn);
  const guessesOnly =
    said !== null && !queries.some((q) => isUsersWords(q) || (words?.says(q) ?? false));

  const clearBy = new Map<number, ClearBy>();
  for (const { query, found } of verdicts) {
    if (!found || (!isUsersWords(query) && contested.has(found.id))) continue;
    if (guessesOnly && !found.byExactName) continue;
    if (words && !isUsersWords(query) && !grounded(pool, found, query, words)) continue;
    if (found.by === "unique" || !clearBy.has(found.id)) clearBy.set(found.id, found.by);
  }
  return pool.map((e) => {
    const by = clearBy.get(e.animeId) ?? null;
    return {
      animeId: e.animeId,
      title: e.title,
      titleEn: e.titleEn,
      mediaType: e.mediaType,
      numEpisodes: e.numEpisodes,
      status: e.status,
      episodesWatched: e.episodesWatched,
      score: e.score,
      isRewatching: e.isRewatching,
      airingStatus: e.airingStatus,
      matchScore: e.matchScore,
      matchedName: e.matchedName,
      clear: by !== null,
      clearBy: by,
    };
  });
}

/**
 * Whether the user's own words point at an entry that a title the model supplied made clear:
 * 1. the query is only their words, rearranged ("isekai chronicles season 2" for "season 2 of
 *    isekai chronicles"),
 * 2. they name it, by one of its names or their initials ("ylia"), or
 * 3. they name another season of the same show, and the code picked this one: by the season or
 *    part number in the query, which the same message gives ("cote s4"), or, with no number, as
 *    the only season in progress ("bsd" is only season 1's nickname, but "watched ep 5 of bsd"
 *    means the season being watched).
 * "Soul Eater" from "the eater one" is neither, and neither is a season number only the model
 * gave ("bsd" searched as "Bungou Stray Dogs 5th Season").
 */
function grounded(
  pool: AnyEntry[],
  found: { id: number; by: ClearBy },
  query: string,
  words: UsersWords,
): boolean {
  if (words.says(query)) return true;
  const entry = pool.find((e) => e.animeId === found.id);
  if (!entry) return false;
  if (entry.names.some((n) => words.names(n))) return true;
  const ref = seasonRef(query);
  const numbered = ref.season !== null || ref.part !== null;
  if (!numbered && found.by !== "only_in_progress") return false;
  return pool.some(
    (other) =>
      (other === entry || seasonsOfOneShow(other, entry)) &&
      other.names.some((n) => words.names(n, numbered ? ref : undefined)),
  );
}

/** The entries tied for best on one query (within CLEAR_MARGIN), if the best is strong enough. */
function contendersFor(pool: AnyEntry[], qi: number): AnyEntry[] {
  const scoreOf = (e: AnyEntry) => e.scores[qi] ?? 0;
  const ranked = pool
    .filter((e) => scoreOf(e) >= MIN_MATCH)
    .sort((a, b) => scoreOf(b) - scoreOf(a));
  const top = ranked[0];
  if (!top || scoreOf(top) < CLEAR_MATCH) return [];
  return ranked.filter((e) => scoreOf(top) - scoreOf(e) < CLEAR_MARGIN);
}

function clearForQuery(
  pool: AnyEntry[],
  qi: number,
  query: string,
  /** The user named this entry exactly in answer to "which one?": siblings don't matter. */
  exactAnswers = false,
  /** A series' movies and specials don't count as its siblings (see SearchOptions). */
  sideStoriesDontCount = false,
): { id: number; by: ClearBy; byExactName: boolean } | null {
  let contenders = contendersFor(pool, qi);
  if (contenders.length === 0) return null;

  const exact = contenders.filter((e) => e.exact[qi]);
  const only = exact.length === 1 ? exact[0] : undefined;
  // Later seasons have a name that starts with the exact one, and titles that show they're the
  // same show. Another show's alternative name doesn't count ("Monster #8" is Kaiju No. 8, not a
  // season of Monster), but seasons sharing one ("DanMachi", "DanMachi II") do.
  const siblings = only
    ? contenders.filter(
        (e) =>
          e !== only &&
          !(sideStoriesDontCount && isSideStory(e) && !isSideStory(only)) &&
          e.names.some((n) => normalizeName(n).startsWith(`${query} `)) &&
          seasonsOfOneShow(only, e),
      )
    : [];
  if (only && (siblings.length === 0 || exactAnswers)) {
    return { id: only.animeId, by: "unique", byExactName: true };
  }

  const wanted = seasonRef(query);
  if (wanted.season !== null || wanted.part !== null) {
    const narrowed = contenders.filter((e) => matchesSeason(e.names, wanted));
    if (narrowed.length > 0) contenders = narrowed;
    else if (numbersItsSeasons(contenders, wanted)) {
      const inferred = unnumberedSeason(contenders, wanted);
      if (!inferred) return null;
      contenders = [inferred];
    }
  }
  if (contenders.length === 1 && contenders[0]) {
    return { id: contenders[0].animeId, by: "unique", byExactName: false };
  }
  if (!sameFranchise(contenders)) return null;

  // In progress: being watched, on hold or rewatched, and already airing.
  const active = contenders.filter(
    (e) =>
      (e.status === "watching" || e.status === "on_hold" || e.isRewatching) &&
      e.airingStatus !== NOT_YET_AIRED,
  );
  return active.length === 1 && active[0]
    ? { id: active[0].animeId, by: "only_in_progress", byExactName: false }
    : null;
}

/** Movies, specials, OVAs and the like, as opposed to a TV or web series. */
const SIDE_STORY_TYPES = ["movie", "special", "ova", "tv_special", "music", "cm", "pv"];

function isSideStory(e: AnyEntry): boolean {
  return e.mediaType !== null && SIDE_STORY_TYPES.includes(e.mediaType);
}

/**
 * The entry that must be season N when no entry is numbered N: MAL names some seasons after
 * their arc ("Nanatsu no Taizai: Kamigami no Gekirin" is season 3). When season N-1 is numbered,
 * it's the one TV entry without a season number that is newer (a higher MAL id) than every
 * entry numbered below N.
 * If none or several fit, or that season comes in parts ("Final Season" and "Final Season Part
 * 2"), the user has to say which, so there's no answer.
 */
function unnumberedSeason(entries: AnyEntry[], wanted: SeasonRef): AnyEntry | null {
  const n = wanted.season;
  if (n === null || n < 2 || wanted.part !== null) return null;
  const seasonsOf = (e: AnyEntry) =>
    e.names.map((name) => seasonRef(name).season).filter((s): s is number => s !== null);
  const lower = entries.filter((e) => seasonsOf(e).some((s) => s < n));
  // Only the season right after the last numbered one can be inferred: "season 4" can't be
  // the unnumbered entry that follows season 2.
  const highestLower = Math.max(0, ...lower.flatMap((e) => seasonsOf(e).filter((s) => s < n)));
  if (lower.length === 0 || highestLower !== n - 1) return null;
  const newestLower = Math.max(...lower.map((e) => e.animeId));
  const later = entries.filter(
    (e) =>
      seasonsOf(e).length === 0 &&
      e.animeId > newestLower &&
      (e.mediaType === "tv" || e.mediaType === "ona"),
  );
  const isLaterPart = (e: AnyEntry) => e.names.some((name) => (seasonRef(name).part ?? 1) > 1);
  if (later.some(isLaterPart)) return null;
  return later.length === 1 ? (later[0] ?? null) : null;
}

/** Whether any of the entries has a number of the kind the query asks for in its names. */
function numbersItsSeasons(entries: AnyEntry[], wanted: SeasonRef): boolean {
  return entries.some((e) =>
    e.names.some((n) => {
      const ref = seasonRef(n);
      return (
        (wanted.season !== null && ref.season !== null) ||
        (wanted.part !== null && ref.part !== null)
      );
    }),
  );
}

/**
 * Whether the entries look like seasons of one franchise: each has a name starting with the
 * same words ("Mushoku Tensei", "Nanatsu no Taizai"). Unrelated shows rarely do.
 */
function sameFranchise(entries: AnyEntry[]): boolean {
  const [first, ...rest] = entries;
  if (!first) return false;
  for (const name of first.names) {
    const words = normalizeName(name).split(" ");
    for (let k = words.length; k > 0; k--) {
      const prefix = words.slice(0, k).join(" ");
      // "the", "a" and the like are too short to mean anything.
      if (prefix.length < 4) break;
      const shared = rest.every((e) =>
        e.names.some((n) => {
          const other = normalizeName(n);
          return other === prefix || other.startsWith(`${prefix} `);
        }),
      );
      if (shared) return true;
    }
  }
  return false;
}

/**
 * A stricter test for two entries, used to spot the model guessing between seasons: by main or
 * English title, one starts the other ("Clannad" and "Clannad: After Story"), or they share their
 * first two words or more ("My Hero Academia Final Season" and "My Hero Academia Season 7").
 * Shows that only share a first word ("Tokyo Ghoul", "Tokyo Revengers") don't count.
 */
function seasonsOfOneShow(a: AnyEntry, b: AnyEntry): boolean {
  const titles = (e: AnyEntry) =>
    [e.title, e.titleEn].filter((t): t is string => !!t).map(normalizeName);
  for (const x of titles(a)) {
    for (const y of titles(b)) {
      if (x === y || x.startsWith(`${y} `) || y.startsWith(`${x} `)) return true;
      const xs = x.split(" ");
      const ys = y.split(" ");
      let shared = 0;
      while (shared < xs.length && shared < ys.length && xs[shared] === ys[shared]) shared++;
      if (shared >= 2) return true;
    }
  }
  return false;
}

/** One entry of the user's list, from the mirror. */
export async function getEntry(
  db: Db,
  userId: string,
  animeId: number,
): Promise<ListEntryView | null> {
  const [row] = await db
    .select({
      animeId: anime.malId,
      title: anime.title,
      titleEn: anime.titleEn,
      mediaType: anime.mediaType,
      numEpisodes: anime.numEpisodes,
      status: listEntries.status,
      episodesWatched: listEntries.numEpisodesWatched,
      score: listEntries.score,
      isRewatching: listEntries.isRewatching,
      airingStatus: anime.airingStatus,
    })
    .from(listEntries)
    .innerJoin(anime, eq(listEntries.animeId, anime.malId))
    .where(and(eq(listEntries.userId, userId), eq(listEntries.animeId, animeId)))
    .limit(1);
  return row ?? null;
}
