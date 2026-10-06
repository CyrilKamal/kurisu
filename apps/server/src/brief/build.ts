import type { StreamingLink } from "../anilist/client.js";
import { siteLabels } from "./services.js";

/** One show in a brief: its new episodes, and where the user can watch them. */
export interface BriefItem {
  malId: number;
  title: string;
  /** New episodes the user hasn't watched yet, ascending. */
  episodes: number[];
  premiere: boolean;
  finale: boolean;
  episodesWatched: number;
  /** Labels of the user's own services that list this show; empty when none match. */
  services: string[];
}

export interface BriefInput {
  /** The user's Watching entries. */
  watching: { malId: number; title: string; episodesWatched: number; numEpisodes: number | null }[];
  /** Episodes that aired in the brief's window, by MAL id. */
  aired: { malId: number; episode: number; airedAt: Date }[];
  /** Each show's official streaming links, by MAL id. */
  links: Map<number, StreamingLink[]>;
  /** The streaming service ids the user picked. */
  services: readonly string[];
}

/**
 * The brief's shows, in the order their new episodes aired. Episodes the user already watched
 * are left out, and so is a show with nothing left.
 */
export function buildBriefItems(input: BriefInput): BriefItem[] {
  const labels = siteLabels(input.services);
  const firstAired = new Map<number, number>();
  const episodes = new Map<number, Set<number>>();
  const entries = new Map(input.watching.map((entry) => [entry.malId, entry]));

  for (const aired of input.aired) {
    const entry = entries.get(aired.malId);
    if (!entry || aired.episode <= entry.episodesWatched) continue;
    const set = episodes.get(aired.malId) ?? new Set<number>();
    set.add(aired.episode);
    episodes.set(aired.malId, set);
    const time = aired.airedAt.getTime();
    firstAired.set(aired.malId, Math.min(firstAired.get(aired.malId) ?? time, time));
  }

  return [...episodes.entries()]
    .sort(([a], [b]) => (firstAired.get(a) ?? 0) - (firstAired.get(b) ?? 0))
    .flatMap(([malId, set]) => {
      const entry = entries.get(malId);
      if (!entry) return [];
      const eps = [...set].sort((a, b) => a - b);
      const services = [
        ...new Set(
          (input.links.get(malId) ?? []).flatMap((link) => {
            const label = labels.get(link.siteId);
            return label ? [label] : [];
          }),
        ),
      ];
      return [
        {
          malId,
          title: entry.title,
          episodes: eps,
          premiere: eps.includes(1),
          finale: entry.numEpisodes !== null && eps.includes(entry.numEpisodes),
          episodesWatched: entry.episodesWatched,
          services,
        },
      ];
    });
}

/** "ep 12", "eps 11–12", "eps 1–3, 5". */
export function episodesLabel(episodes: number[]): string {
  return `${episodes.length === 1 ? "ep" : "eps"} ${episodeRanges(episodes)}`;
}

function episodeRanges(episodes: number[]): string {
  const ranges: string[] = [];
  let start = episodes[0];
  let prev = start;
  for (const ep of [...episodes.slice(1), undefined]) {
    if (ep !== undefined && prev !== undefined && ep === prev + 1) {
      prev = ep;
      continue;
    }
    if (start !== undefined && prev !== undefined) {
      ranges.push(start === prev ? String(start) : `${String(start)}–${String(prev)}`);
    }
    start = ep;
    prev = ep;
  }
  return ranges.join(", ");
}

export function episodeCount(items: BriefItem[]): number {
  return items.reduce((sum, item) => sum + item.episodes.length, 0);
}

/** The fallback summary line, when the model doesn't write one. */
export function templateSummary(items: BriefItem[]): string {
  const [only] = items;
  if (items.length === 1 && only) {
    return only.episodes.length === 1
      ? `${only.title} has a new episode.`
      : `${only.title} has ${String(only.episodes.length)} new episodes.`;
  }
  return `${String(episodeCount(items))} new episodes from ${String(items.length)} shows you're watching.`;
}

/** One line per show for the chat message, e.g. "- Frieren ep 12 on Crunchyroll (you're on ep 10)". */
export function itemLine(item: BriefItem): string {
  const tags = [item.premiere ? "premiere" : null, item.finale ? "finale" : null].filter(Boolean);
  const first = item.episodes[0] ?? 0;
  const behind = item.episodesWatched > 0 && item.episodesWatched < first - 1;
  return [
    `- ${item.title} ${episodesLabel(item.episodes)}`,
    tags.length > 0 ? ` (${tags.join(", ")})` : "",
    item.services.length > 0 ? ` on ${item.services.join(" or ")}` : "",
    behind ? `. You're on ep ${String(item.episodesWatched)}.` : "",
  ].join("");
}

/** The last line of every brief in chat: how to reply. */
export const BRIEF_REPLY_HINT = `Reply "watched it" once you've caught up on all of these.`;

/** The brief as a chat message: the summary line, one line per show, then the reply hint. */
export function chatText(summary: string, items: BriefItem[]): string {
  return [summary, "", ...items.map(itemLine), "", BRIEF_REPLY_HINT].join("\n");
}

/** One "- Title ep 12 …" or "- Title eps 11–12 …" line, as itemLine writes it. */
const ITEM_LINE = /^- (.+?) eps? (\d+(?:–\d+)?(?:, \d+(?:–\d+)?)*)(?: \(|\.| on |$)/;

/**
 * Reads a brief's chat text back into each show's title and the last episode it listed. The app
 * itself knows a brief's items from the briefs table; the eval uses this for briefs written into a
 * case's history. Empty when the text isn't a brief.
 */
export function parseBriefText(text: string): { title: string; lastEpisode: number }[] {
  const lines = text.split("\n");
  if (!lines.includes(BRIEF_REPLY_HINT)) return [];
  return lines.flatMap((line) => {
    const match = ITEM_LINE.exec(line);
    if (!match?.[1] || !match[2]) return [];
    const last = match[2].split(/[,–]\s*/).at(-1);
    return last ? [{ title: match[1], lastEpisode: Number(last) }] : [];
  });
}

const PUSH_BODY_SHOWS = 4;

/** The notification: short enough for a lock screen. */
export function pushText(items: BriefItem[]): { title: string; body: string } {
  const [only] = items;
  if (items.length === 1 && only) {
    const where = only.services.length > 0 ? `On ${only.services.join(" or ")}. ` : "";
    return {
      title: `${only.title} ${episodesLabel(only.episodes)}${only.premiere ? " (premiere)" : ""}`,
      body: `${where}Tap to open the chat.`,
    };
  }
  const shown = items.slice(0, PUSH_BODY_SHOWS).map((item) => {
    const eps = episodesLabel(item.episodes).replace(/^eps? /, "");
    return `${item.title} ${eps}${item.premiere ? " (premiere)" : ""}`;
  });
  const more = items.length - shown.length;
  return {
    title: `${String(episodeCount(items))} new episodes`,
    body: [...shown, ...(more > 0 ? [`+${String(more)} more`] : [])].join(" · "),
  };
}
