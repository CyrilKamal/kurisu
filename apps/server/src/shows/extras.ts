import type { ShowExtrasView } from "@kurisu/shared";
import { and, eq, inArray } from "drizzle-orm";

import { animeRowFromAniList } from "../anilist/catalog.js";
import type { CatalogShow, ShowPageExtras } from "../anilist/client.js";
import { STREAMING_SERVICES } from "../brief/services.js";
import { seasonLabel } from "../browse/seasons.js";
import type { Db } from "../db/client.js";
import { listEntries } from "../db/schema.js";

/** Related anime in watch order: what comes before and after first, then the rest. */
const RELATION_ORDER = [
  "PREQUEL",
  "SEQUEL",
  "PARENT",
  "SIDE_STORY",
  "SPIN_OFF",
  "ALTERNATIVE",
  "SUMMARY",
  "COMPILATION",
  "CONTAINS",
  "CHARACTER",
  "OTHER",
];
/** The tags and episode links a page shows at most. */
const MAX_TAGS = 20;
const MAX_EPISODES = 100;

/** "https://www.youtube.com/watch?v=…" for AniList's trailer, or null for another site. */
export function trailerLink(trailer: ShowPageExtras["trailer"]): ShowExtrasView["trailer"] {
  if (!trailer || !/^[\w-]+$/.test(trailer.id)) return null;
  if (trailer.site === "youtube") {
    const thumbnail = trailer.thumbnail?.startsWith("https://i.ytimg.com/")
      ? trailer.thumbnail
      : null;
    return { url: `https://www.youtube.com/watch?v=${trailer.id}`, thumbnail };
  }
  if (trailer.site === "dailymotion") {
    return { url: `https://www.dailymotion.com/video/${trailer.id}`, thumbnail: null };
  }
  return null;
}

/** How wide a ranking's scope is: all time beats a year, which beats a season. */
function breadth(r: ShowPageExtras["rankings"][number]): number {
  return r.allTime ? 2 : r.season ? 0 : 1;
}

/**
 * The best ranking of each kind (most popular, highest rated): the lowest number, and on a tie
 * the widest scope. "#1 highest rated, all time" rather than also "#1 highest rated, 2023".
 */
export function bestRankings(rankings: ShowPageExtras["rankings"]): ShowExtrasView["rankings"] {
  const out: ShowExtrasView["rankings"] = [];
  for (const type of ["POPULAR", "RATED"] as const) {
    const best = rankings
      .filter((r) => r.type === type && (r.allTime || r.year !== null))
      .sort((a, b) => a.rank - b.rank || breadth(b) - breadth(a))[0];
    if (!best) continue;
    const scope = best.allTime
      ? "all time"
      : best.season && best.year
        ? seasonLabel({ season: best.season, year: best.year })
        : String(best.year);
    out.push({ rank: best.rank, kind: type === "RATED" ? "rated" : "popular", scope });
  }
  return out;
}

/** Official episode links on the user's own services, by AniList's site name. */
export function episodesOnServices(
  episodes: ShowPageExtras["episodes"],
  serviceIds: readonly string[],
): ShowExtrasView["episodes"] {
  const labels = new Map(
    STREAMING_SERVICES.filter((s) => serviceIds.includes(s.id)).map((s) => [
      s.label.toLowerCase(),
      s.label,
    ]),
  );
  return episodes
    .flatMap((e) => {
      const service = labels.get(e.site.toLowerCase());
      return service && e.url.startsWith("https://")
        ? [{ title: e.title, url: e.url, service }]
        : [];
    })
    .slice(-MAX_EPISODES);
}

/**
 * A page's extras as the user sees them: where each related or recommended show stands on
 * their list, relations in watch order, and episode links only on their services.
 */
export async function extrasView(
  db: Db,
  userId: string,
  extras: ShowPageExtras,
  serviceIds: readonly string[],
): Promise<ShowExtrasView> {
  const shows = [...extras.relations, ...extras.recommendations]
    .map((linked) => linked.show)
    .filter((show): show is CatalogShow & { malId: number } => show.malId !== null);
  const ids = [...new Set(shows.map((show) => show.malId))];
  const statuses = new Map(
    (ids.length === 0
      ? []
      : await db
          .select({ animeId: listEntries.animeId, status: listEntries.status })
          .from(listEntries)
          .where(and(eq(listEntries.userId, userId), inArray(listEntries.animeId, ids)))
    ).map((row) => [row.animeId, row.status]),
  );
  const linked = (show: CatalogShow & { malId: number }) => ({
    animeId: show.malId,
    title: show.title,
    pictureUrl: show.coverUrl?.startsWith("https://") ? show.coverUrl : null,
    mediaType: animeRowFromAniList(show).mediaType ?? null,
    startDate: show.startDate,
    status: statuses.get(show.malId) ?? null,
  });
  const order = (relation: string) => {
    const i = RELATION_ORDER.indexOf(relation);
    return i === -1 ? RELATION_ORDER.length : i;
  };

  return {
    studios: extras.studios,
    source: extras.source,
    season: extras.season ? seasonLabel(extras.season) : null,
    score: extras.averageScore === null ? null : extras.averageScore / 10,
    rankings: bestRankings(extras.rankings),
    trailer: trailerLink(extras.trailer),
    tags: extras.tags.slice(0, MAX_TAGS),
    relations: extras.relations
      .flatMap((r) =>
        r.show.malId === null
          ? []
          : [{ ...linked({ ...r.show, malId: r.show.malId }), relation: r.relation }],
      )
      .map((r, i) => ({ r, i }))
      .sort((a, b) => order(a.r.relation) - order(b.r.relation) || a.i - b.i)
      .map(({ r }) => r),
    characters: extras.characters.map((c) => ({
      name: c.name,
      role: c.role === "MAIN" ? "main" : c.role === "BACKGROUND" ? "background" : "supporting",
      pictureUrl: c.image?.startsWith("https://") ? c.image : null,
      voiceActor: c.voiceActor
        ? {
            name: c.voiceActor.name,
            pictureUrl: c.voiceActor.image?.startsWith("https://") ? c.voiceActor.image : null,
          }
        : null,
    })),
    recommendations: extras.recommendations.flatMap((r) =>
      r.show.malId === null ? [] : [linked({ ...r.show, malId: r.show.malId })],
    ),
    episodes: episodesOnServices(extras.episodes, serviceIds),
    // Extras stored before staff and the score spread were fetched have neither until the next.
    staff: (extras.staff ?? []).map((s) => ({
      name: s.name,
      role: s.role,
      pictureUrl: s.image?.startsWith("https://") ? s.image : null,
    })),
    scoreDistribution: scoreSpread(extras.scoreDistribution ?? []),
  };
}

/**
 * AniList's score spread as ten columns, 10 to 100, each the share of its users (0–1); null when
 * too few have scored it to say.
 */
export function scoreSpread(
  distribution: readonly { score: number; amount: number }[],
): { score: number; share: number }[] | null {
  const total = distribution.reduce((sum, d) => sum + d.amount, 0);
  if (total < MIN_SCORES_FOR_SPREAD) return null;
  return Array.from({ length: 10 }, (_, i) => {
    const score = (i + 1) * 10;
    const amount = distribution.find((d) => d.score === score)?.amount ?? 0;
    return { score, share: amount / total };
  });
}

/** Fewer AniList scores than this say little about how a show is liked. */
const MIN_SCORES_FOR_SPREAD = 20;
