/**
 * AniList's genres and tags in MAL's genre names, so shows found on AniList filter and rank with
 * the same names as the user's list ("Slice of Life", "Iyashikei", "Seinen").
 */

/** MAL's genres, themes and demographics. */
export const MAL_GENRES = [
  // Genres
  "Action",
  "Adventure",
  "Avant Garde",
  "Award Winning",
  "Boys Love",
  "Comedy",
  "Drama",
  "Ecchi",
  "Fantasy",
  "Girls Love",
  "Gourmet",
  "Horror",
  "Mystery",
  "Romance",
  "Sci-Fi",
  "Slice of Life",
  "Sports",
  "Supernatural",
  "Suspense",
  // Themes
  "Adult Cast",
  "Anthropomorphic",
  "CGDCT",
  "Childcare",
  "Combat Sports",
  "Crossdressing",
  "Delinquents",
  "Detective",
  "Educational",
  "Gag Humor",
  "Gore",
  "Harem",
  "High Stakes Game",
  "Historical",
  "Isekai",
  "Iyashikei",
  "Love Polygon",
  "Love Status Quo",
  "Mahou Shoujo",
  "Martial Arts",
  "Mecha",
  "Medical",
  "Military",
  "Music",
  "Mythology",
  "Organized Crime",
  "Otaku Culture",
  "Parody",
  "Performing Arts",
  "Pets",
  "Psychological",
  "Racing",
  "Reincarnation",
  "Reverse Harem",
  "Samurai",
  "School",
  "Showbiz",
  "Space",
  "Strategy Game",
  "Super Power",
  "Survival",
  "Team Sports",
  "Time Travel",
  "Urban Fantasy",
  "Vampire",
  "Video Game",
  "Villainess",
  "Visual Arts",
  "Workplace",
  // Demographics
  "Josei",
  "Kids",
  "Seinen",
  "Shoujo",
  "Shounen",
] as const;

/** AniList's genres; everything else on AniList is a tag. */
const ANILIST_GENRES = new Set([
  "Action",
  "Adventure",
  "Comedy",
  "Drama",
  "Ecchi",
  "Fantasy",
  "Horror",
  "Mahou Shoujo",
  "Mecha",
  "Music",
  "Mystery",
  "Psychological",
  "Romance",
  "Sci-Fi",
  "Slice of Life",
  "Sports",
  "Supernatural",
  "Thriller",
]);

/** AniList names that MAL calls something else. */
const TO_MAL: Record<string, string> = {
  Thriller: "Suspense",
  "Cute Girls Doing Cute Things": "CGDCT",
  "Primarily Adult Cast": "Adult Cast",
  "Video Games": "Video Game",
  Cooking: "Gourmet",
  Food: "Gourmet",
  "Criminal Organization": "Organized Crime",
  "Love Triangle": "Love Polygon",
  Medicine: "Medical",
  Acting: "Performing Arts",
  Anthropomorphism: "Anthropomorphic",
  Slapstick: "Gag Humor",
};
const FROM_MAL = new Map(Object.entries(TO_MAL).map(([anilist, mal]) => [mal, anilist]));

const MAL_BY_LOWER = new Map(MAL_GENRES.map((g) => [g.toLowerCase(), g]));

/** A tag counts when AniList says it's at least this central to the show, out of 100. */
export const MIN_TAG_RANK = 60;

/** MAL's names for a show's AniList genres and main tags, without repeats. */
export function malGenresFrom(
  genres: string[],
  tags: { name: string; rank: number | null; isMediaSpoiler: boolean | null }[],
): string[] {
  const names = [
    ...genres,
    ...tags
      .filter((t) => (t.rank ?? 0) >= MIN_TAG_RANK && t.isMediaSpoiler !== true)
      .map((t) => t.name),
  ];
  const out: string[] = [];
  for (const name of names) {
    const mal = MAL_BY_LOWER.get((TO_MAL[name] ?? name).toLowerCase());
    if (mal && !out.includes(mal)) out.push(mal);
  }
  return out;
}

/** How to ask AniList for shows with one of MAL's genres: as an AniList genre or a tag. */
export function aniListFilterFor(malGenre: string): { genre: string } | { tag: string } {
  const name = FROM_MAL.get(malGenre) ?? malGenre;
  return ANILIST_GENRES.has(name) ? { genre: name } : { tag: name };
}
