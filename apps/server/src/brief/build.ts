import type { StreamingLink } from "../anilist/client.js";
import { siteLabels, watchOn } from "./services.js";

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

/** A show that started airing in the brief's window. */
export interface BriefAlert {
  malId: number;
  title: string;
  /** A sequel to a show they completed, or a show on their Plan to Watch. */
  kind: "sequel_started" | "ptw_started";
  /** For a sequel: the title of the show they finished that it follows. */
  after: string | null;
  /** Labels of the user's own services that list it; empty when none match. */
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

/** What a brief's alerts come from: shows that could start airing for the user. */
export interface AlertInput {
  /** Plan to Watch shows that are airing or about to. */
  ptw: { malId: number; title: string }[];
  /** Sequels to shows they completed, not on their list. */
  sequels: { malId: number; title: string; after: string }[];
  /** Episodes that aired in the brief's window, by MAL id, in MAL's numbering. */
  aired: { malId: number; episode: number; airedAt: Date }[];
  /** Each show's official streaming links, by MAL id. */
  links: Map<number, StreamingLink[]>;
  /** The streaming service ids the user picked. */
  services: readonly string[];
}

/**
 * Shows whose first episode aired in the window, in the order they premiered. A later episode
 * isn't news, since the premiere was. A show that is both on Plan to Watch and a sequel counts
 * once, as Plan to Watch.
 */
export function buildBriefAlerts(input: AlertInput): BriefAlert[] {
  const premiered = new Map<number, number>();
  for (const aired of input.aired) {
    if (aired.episode !== 1) continue;
    const time = aired.airedAt.getTime();
    premiered.set(aired.malId, Math.min(premiered.get(aired.malId) ?? time, time));
  }
  const where = (malId: number) =>
    watchOn(input.links.get(malId) ?? [], input.services).map((w) => w.service);

  const alerts = new Map<number, BriefAlert>();
  for (const show of input.ptw) {
    if (!premiered.has(show.malId)) continue;
    alerts.set(show.malId, {
      malId: show.malId,
      title: show.title,
      kind: "ptw_started",
      after: null,
      services: where(show.malId),
    });
  }
  for (const show of input.sequels) {
    if (!premiered.has(show.malId) || alerts.has(show.malId)) continue;
    alerts.set(show.malId, {
      malId: show.malId,
      title: show.title,
      kind: "sequel_started",
      after: show.after,
      services: where(show.malId),
    });
  }
  return [...alerts.values()].sort(
    (a, b) => (premiered.get(a.malId) ?? 0) - (premiered.get(b.malId) ?? 0),
  );
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

/** The summary line of a brief with no new episodes, only shows that started airing. */
export function alertSummary(alerts: BriefAlert[]): string {
  const [only] = alerts;
  if (alerts.length === 1 && only) return `${only.title} started airing.`;
  return `${String(alerts.length)} shows you follow started airing.`;
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

/** The line under a brief's new episodes: how to reply. */
export const BRIEF_REPLY_HINT = `Reply "watched it" once you've caught up on all of these.`;

/** The heading over the shows that started airing, in a brief that also has new episodes. */
export const ALERTS_HEADING = "Started airing:";

/**
 * One line per show that started airing, e.g. "- Dandadan Season 2. You finished Dandadan. On
 * Crunchyroll." The heading or the summary says they started airing.
 */
export function alertLine(alert: BriefAlert): string {
  const why =
    alert.kind === "ptw_started"
      ? " It's on your Plan to Watch."
      : alert.after
        ? ` You finished ${alert.after}.`
        : "";
  const where = alert.services.length > 0 ? ` On ${alert.services.join(" or ")}.` : "";
  return `- ${alert.title}.${why}${where}`;
}

/**
 * The brief as a chat message: the summary line, one line per show with new episodes and the
 * reply hint, then the shows that started airing, then a Sunday's recap paragraph. The hint
 * sits right under the episodes it's about; "watched it" never covers a show that only started
 * airing.
 */
export function chatText(
  summary: string,
  items: BriefItem[],
  alerts: BriefAlert[] = [],
  recap: string | null = null,
): string {
  const lines = [summary];
  if (items.length > 0) lines.push("", ...items.map(itemLine), "", BRIEF_REPLY_HINT);
  if (alerts.length > 0) {
    lines.push("", ...(items.length > 0 ? [ALERTS_HEADING] : []), ...alerts.map(alertLine));
  }
  if (recap) lines.push("", recap);
  return lines.join("\n");
}

/** The title of a brief's chat, from the user's local date: "Brief, Oct 6". */
export function briefTitle(localDate: string): string {
  const date = new Date(`${localDate}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return "Brief";
  const day = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(date);
  return `Brief, ${day}`;
}

/** One "- Title ep 12 …" or "- Title eps 11–12 …" line, as itemLine writes it. */
const ITEM_LINE = /^- (.+?) eps? (\d+(?:–\d+)?(?:, \d+(?:–\d+)?)*)(?: \(|\.| on |$)/;

/**
 * Reads a brief's chat text back into each show's title and the episodes it listed, ascending.
 * The app itself knows a brief's items from the briefs table; the eval uses this for briefs
 * written into a case's history. Empty when the text isn't a brief.
 */
export function parseBriefText(text: string): { title: string; episodes: number[] }[] {
  const lines = text.split("\n");
  if (!lines.includes(BRIEF_REPLY_HINT)) return [];
  return lines.flatMap((line) => {
    const match = ITEM_LINE.exec(line);
    if (!match?.[1] || !match[2]) return [];
    const episodes = match[2].split(/,\s*/).flatMap((range) => {
      const [from, to] = range.split("–").map(Number);
      if (from === undefined) return [];
      return Array.from({ length: (to ?? from) - from + 1 }, (_, i) => from + i);
    });
    return [{ title: match[1], episodes }];
  });
}

const PUSH_BODY_SHOWS = 4;

/** The notification: short enough for a lock screen. */
export function pushText(
  items: BriefItem[],
  alerts: BriefAlert[] = [],
): { title: string; body: string } {
  if (items.length === 0) return alertPushText(alerts);
  const started =
    alerts.length > 0 ? `Started airing: ${alerts.map((a) => a.title).join(", ")}. ` : "";
  const [only] = items;
  if (items.length === 1 && only) {
    const where = only.services.length > 0 ? `On ${only.services.join(" or ")}. ` : "";
    return {
      title: `${only.title} ${episodesLabel(only.episodes)}${only.premiere ? " (premiere)" : ""}`,
      body: `${where}${started}Tap to open the chat.`,
    };
  }
  const shown = items.slice(0, PUSH_BODY_SHOWS).map((item) => {
    const eps = episodesLabel(item.episodes).replace(/^eps? /, "");
    return `${item.title} ${eps}${item.premiere ? " (premiere)" : ""}`;
  });
  const more = items.length - shown.length;
  const body = [...shown, ...(more > 0 ? [`+${String(more)} more`] : [])].join(" · ");
  return {
    title: `${String(episodeCount(items))} new episodes`,
    body: started ? `${body}. ${started.trim()}` : body,
  };
}

/** The notification for a brief with only shows that started airing. */
function alertPushText(alerts: BriefAlert[]): { title: string; body: string } {
  const [only] = alerts;
  if (alerts.length === 1 && only) {
    const why =
      only.kind === "ptw_started"
        ? "It's on your Plan to Watch. "
        : only.after
          ? `You finished ${only.after}. `
          : "";
    const where = only.services.length > 0 ? `On ${only.services.join(" or ")}. ` : "";
    return { title: `${only.title} started airing`, body: `${why}${where}Tap to open the chat.` };
  }
  const shown = alerts.slice(0, PUSH_BODY_SHOWS).map((a) => a.title);
  const more = alerts.length - shown.length;
  return {
    title: `${String(alerts.length)} shows started airing`,
    body: [...shown, ...(more > 0 ? [`+${String(more)} more`] : [])].join(" · "),
  };
}
