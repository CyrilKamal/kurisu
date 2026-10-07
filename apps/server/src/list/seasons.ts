/**
 * Season and part numbers in titles and search queries: "Season 2", "2nd Season", "III", "s2",
 * "Part 2", "Cour 2", or a trailing number ("One Punch Man 3"). Search uses them to pick the
 * right entry among a franchise's near-identical titles. Episode numbers ("ep 5") are ignored.
 */
export interface SeasonRef {
  season: number | null;
  part: number | null;
}

const ROMAN: Record<string, number> = { ii: 2, iii: 3, iv: 4, vi: 6, vii: 7, viii: 8, ix: 9 };
const ORDINAL_WORDS: Record<string, number> = {
  second: 2,
  third: 3,
  fourth: 4,
  fifth: 5,
  sixth: 6,
};

/** Lowercase words and digits only, so "Gangsta." and "gangsta" compare equal. */
export function normalizeName(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export function seasonRef(text: string): SeasonRef {
  const t = normalizeName(text)
    .replace(/\b(?:ep|eps|episode|episodes)\s+\d+\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return { season: findSeason(t), part: findPart(t) };
}

function findSeason(t: string): number | null {
  const numbered =
    /\bseason (\d{1,2})\b/.exec(t) ??
    /\b(\d{1,2})(?:st|nd|rd|th) season\b/.exec(t) ??
    /\bs(\d{1,2})\b/.exec(t);
  if (numbered) return Number(numbered[1]);
  const worded = /\b(second|third|fourth|fifth|sixth) season\b/.exec(t);
  if (worded?.[1]) return ORDINAL_WORDS[worded[1]] ?? null;
  for (const token of t.split(" ")) {
    const roman = ROMAN[token];
    if (roman) return roman;
  }
  // A trailing number ("bungo stray dogs 4"), unless it's a part ("... part 2").
  const trailing = /(?:^|\s)(\d{1,2})$/.exec(t);
  if (trailing && !/\b(?:part|cour) \d{1,2}$/.test(t)) return Number(trailing[1]);
  return null;
}

function findPart(t: string): number | null {
  const m = /\b(?:part|cour) (\d{1,2})\b/.exec(t) ?? /\b(\d{1,2})(?:st|nd|rd|th) cour\b/.exec(t);
  return m ? Number(m[1]) : null;
}

/**
 * Every season and part number a message gives in so many words: "s4", "season 3", "2nd season",
 * "second season", "II", "part 2", "cour 2". A bare number isn't one: in "rated it a 10" or
 * "watched 3 eps" it's a score or a count, so the trailing-number rule of seasonRef is left out.
 */
export function seasonMarkers(text: string): { seasons: Set<number>; parts: Set<number> } {
  const t = normalizeName(text);
  const seasons = new Set<number>();
  for (const m of t.matchAll(
    /\b(?:season (\d{1,2})|(\d{1,2})(?:st|nd|rd|th) season|s(\d{1,2}))\b/g,
  )) {
    seasons.add(Number(m[1] ?? m[2] ?? m[3]));
  }
  for (const m of t.matchAll(/\b(second|third|fourth|fifth|sixth) season\b/g)) {
    const n = m[1] ? ORDINAL_WORDS[m[1]] : undefined;
    if (n) seasons.add(n);
  }
  for (const token of t.split(" ")) {
    const roman = ROMAN[token];
    if (roman) seasons.add(roman);
  }
  const parts = new Set<number>();
  for (const m of t.matchAll(/\b(?:(?:part|cour) (\d{1,2})|(\d{1,2})(?:st|nd|rd|th) cour)\b/g)) {
    parts.add(Number(m[1] ?? m[2]));
  }
  return { seasons, parts };
}

/**
 * Whether an entry, by any of its names, is the season and part a query asks for. An entry with
 * no season number counts as season 1, and one with no part number as part 1.
 */
export function matchesSeason(names: string[], wanted: SeasonRef): boolean {
  const refs = names.map(seasonRef);
  const seasons = new Set(refs.map((r) => r.season).filter((n): n is number => n !== null));
  const parts = new Set(refs.map((r) => r.part).filter((n): n is number => n !== null));
  const seasonOk =
    wanted.season === null ||
    (seasons.size === 0 ? wanted.season === 1 : seasons.has(wanted.season));
  const partOk =
    wanted.part === null || (parts.size === 0 ? wanted.part === 1 : parts.has(wanted.part));
  return seasonOk && partOk;
}
