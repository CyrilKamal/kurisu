"use client";

import type { AiringView, ListStatus } from "@kurisu/shared";

import { airingLine } from "@/lib/airing";
import { useIsBrowser } from "@/lib/useIsBrowser";

/**
 * A row's AiringCountdown: "2 out · eps 8–9" in crimson, or "ep 10 in 2d 4h". It counts from the
 * viewer's clock, so it's only drawn in the browser.
 */
export function AiringLine({
  airing,
  status,
  episodesWatched,
}: {
  airing: AiringView | null;
  status: ListStatus;
  episodesWatched: number;
}) {
  const inBrowser = useIsBrowser();
  if (!inBrowser) return null;
  const line = airingLine(airing, { status, episodesWatched }, new Date());
  if (!line) return null;
  return <span className={line.out ? "k-airing k-airing--today" : "k-airing"}>{line.text}</span>;
}
