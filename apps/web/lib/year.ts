import type { YearReview } from "@kurisu/shared";

import { hoursWatched, showCount } from "./stats";

export const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/**
 * The year in a few lines to share: "My 2026 in anime: 42 shows finished · 512 episodes, 213
 * hours · Mostly Fantasy · Favorite: Frieren (10/10)". Only what the review counted.
 */
export function yearShareText(review: YearReview): string {
  const { basic } = review;
  const parts = [`${showCount(basic.completed)} finished`];
  if (basic.episodes > 0) {
    const hours = basic.minutes > 0 ? `, ${hoursWatched(basic.minutes)} hours` : "";
    parts.push(`${basic.episodes.toLocaleString("en-US")} episodes${hours}`);
  }
  if (basic.topGenre) parts.push(`Mostly ${basic.topGenre}`);
  if (basic.favorite) {
    parts.push(`Favorite: ${basic.favorite.title} (${String(basic.favorite.score)}/10)`);
  }
  const so = review.year === review.currentYear ? " so far" : "";
  return `My ${String(review.year)} in anime${so}: ${parts.join(" · ")}`;
}
