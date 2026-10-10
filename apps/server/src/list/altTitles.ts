/** The English title and synonyms, without blanks or repeats of the main title. */
export function altTitles(title: string, titleEn: string | null, synonyms: string[]): string[] {
  const seen = new Set([title.toLowerCase()]);
  const result: string[] = [];
  for (const name of [titleEn ?? "", ...synonyms]) {
    const key = name.trim().toLowerCase();
    if (key && !seen.has(key)) {
      seen.add(key);
      result.push(name.trim());
    }
  }
  return result;
}
