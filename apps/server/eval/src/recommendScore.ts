import type { ListStatus } from "@kurisu/shared";

import type { StreamingLink } from "../../src/anilist/client.js";
import { STREAMING_SERVICES, watchOn } from "../../src/brief/services.js";
import { NOT_YET_AIRED } from "../../src/mal/client.js";
import type { RecommendCase } from "./recommendCases.js";

/** A picked show with what the checks need, from the list or the discovery pool. */
export interface PickedShow {
  animeId: number;
  title: string;
  /** Its status on the user's list; null for a show new to them. */
  status: ListStatus | null;
  isRewatching: boolean;
  /** Whether a show new to the user is in their discovery pool. */
  inPool: boolean;
  mediaType: string | null;
  /** Null when MAL doesn't know the total yet. */
  numEpisodes: number | null;
  episodesWatched: number;
  episodeMinutes: number | null;
  genres: string[];
  airingStatus: string | null;
  /** The year it started airing; null when unknown. */
  startYear: number | null;
  /** Where it streams, from the frozen AniList links; [] when unknown. */
  streamingLinks: StreamingLink[];
}

type Expect = RecommendCase["expect"];

/** How many years outside the asked-for years a pick started airing; null when unknown. */
function yearsOutside(pick: PickedShow, expect: Expect): number | null {
  if (pick.startYear === null) return null;
  const before = expect.year_from === undefined ? 0 : expect.year_from - pick.startYear;
  const after = expect.year_to === undefined ? 0 : pick.startYear - expect.year_to;
  return Math.max(before, after, 0);
}

function yearRange(expect: Expect): string {
  const { year_from: from, year_to: to } = expect;
  if (from !== undefined && to !== undefined) return `${String(from)}-${String(to)}`;
  return from !== undefined ? `${String(from)} on` : `up to ${String(to)}`;
}

/** Whether a pick is a near miss the grace allows: a little over the time or outside the years. */
function nearMiss(pick: PickedShow, expect: Expect): boolean {
  const overTime =
    expect.grace_minutes !== undefined &&
    expect.max_episode_minutes !== undefined &&
    (pick.episodeMinutes ?? 0) > expect.max_episode_minutes;
  const offYears = expect.grace_years !== undefined && (yearsOutside(pick, expect) ?? 0) > 0;
  return overTime || offYears;
}

export interface Violation {
  animeId: number;
  /** "invalid": not a show that could be recommended at all. "constraint": breaks a label. */
  kind: "invalid" | "constraint";
  message: string;
}

/** Why a pick couldn't be recommended at all, whatever was asked. */
function invalidity(pick: PickedShow): string | null {
  if (pick.status === null) return pick.inPool ? null : "neither on the list nor in the pool";
  if (pick.status === "completed" && !pick.isRewatching) return "already completed";
  if (pick.status === "dropped") return "dropped";
  if (pick.airingStatus === NOT_YET_AIRED) return "hasn't aired yet";
  return null;
}

function sourceProblem(pick: PickedShow, source: RecommendCase["expect"]["source"]): string | null {
  const inProgress =
    pick.status === "watching" ||
    pick.status === "on_hold" ||
    (pick.status === "completed" && pick.isRewatching);
  switch (source) {
    case "any":
      return null;
    case "list":
      return pick.status === null ? "new to you, but your list was asked for" : null;
    case "plan_to_watch":
      return pick.status === "plan_to_watch" ? null : "not on Plan to Watch";
    case "in_progress":
      return inProgress ? null : "not a show in progress";
    case "started":
      return inProgress && pick.episodesWatched > 0 ? null : "not a show you've started";
    case "new":
      return pick.status === null ? null : "on your list, but something new was asked for";
  }
}

/** Everything wrong with one pick for this case's labels. */
export function checkPick(
  pick: PickedShow,
  expect: RecommendCase["expect"],
  mustNot: Set<number>,
): Violation[] {
  const violations: Violation[] = [];
  const constraint = (message: string) =>
    violations.push({ animeId: pick.animeId, kind: "constraint", message });

  const invalid = invalidity(pick);
  if (invalid) violations.push({ animeId: pick.animeId, kind: "invalid", message: invalid });

  if (mustNot.has(pick.animeId)) constraint("must not be picked");
  if (expect.media_types && !expect.media_types.some((t) => t === pick.mediaType)) {
    constraint(
      `a ${pick.mediaType ?? "show of unknown type"}, not ${expect.media_types.join("/")}`,
    );
  }
  if (expect.max_episode_minutes !== undefined) {
    const grace = expect.grace_minutes ?? 0;
    if (pick.episodeMinutes === null) constraint("episode length unknown");
    else if (pick.episodeMinutes > expect.max_episode_minutes + grace) {
      constraint(
        `${String(pick.episodeMinutes)}-minute episodes, over ${String(expect.max_episode_minutes)}` +
          (grace > 0 ? ` plus ${String(grace)} minutes of grace` : ""),
      );
    }
  }
  if (expect.max_episodes_left !== undefined) {
    const left =
      pick.numEpisodes === null ? null : Math.max(0, pick.numEpisodes - pick.episodesWatched);
    if (left === null) constraint("episode count unknown");
    else if (left > expect.max_episodes_left) {
      constraint(`${String(left)} episodes left, over ${String(expect.max_episodes_left)}`);
    }
  }
  if (expect.year_from !== undefined || expect.year_to !== undefined) {
    const off = yearsOutside(pick, expect);
    const grace = expect.grace_years ?? 0;
    if (off === null) constraint("air year unknown");
    else if (off > grace) {
      constraint(
        `aired ${String(pick.startYear)}, outside ${yearRange(expect)}` +
          (grace > 0 ? ` plus ${String(grace)} years of grace` : ""),
      );
    }
  }
  const genres = new Set(pick.genres.map((g) => g.toLowerCase()));
  const unwanted = (expect.genres_none ?? []).filter((g) => genres.has(g.toLowerCase()));
  if (unwanted.length > 0) constraint(`has ${unwanted.join(", ")}`);
  const source = sourceProblem(pick, expect.source);
  if (source) constraint(source);
  if (expect.streams_on && watchOn(pick.streamingLinks, expect.streams_on).length === 0) {
    const everywhere = watchOn(
      pick.streamingLinks,
      STREAMING_SERVICES.map((s) => s.id),
    ).map((w) => w.service);
    constraint(
      `not on ${expect.streams_on.join("/")} (AniList lists ${everywhere.length > 0 ? everywhere.join(", ") : "none of the services we know"})`,
    );
  }
  return violations;
}

/** Whether a pick has at least one of the wanted genres. */
export function fitsGenres(pick: PickedShow, genresAny: string[]): boolean {
  const genres = new Set(pick.genres.map((g) => g.toLowerCase()));
  return genresAny.some((g) => genres.has(g.toLowerCase()));
}

export interface RecommendRun {
  file: string;
  caseId: string;
  tags: string[];
  message: string;
  /** Whether the progress agent handed the message to the recommender. */
  handedOff: boolean;
  picks: PickedShow[];
  reply: string;
  error: string | null;
  /** Both agents, without time spent waiting on the rate limit. */
  latencyMs: number;
  costUsd: number | null;
  inputTokens: number;
  outputTokens: number;
  toolCalls: string[];
}

export interface RecommendScore {
  correct: boolean;
  /** Why the case failed, if it did. */
  reasons: string[];
  violations: Violation[];
  /** Picks with a wanted genre, out of all picks; null when the case wants no genre. */
  genreFit: { fit: number; total: number } | null;
}

/**
 * A case is right when the message reached the recommender, the picks (or the lack of them) are
 * what was expected, and every pick is valid and within the labels. Genre fit is reported, not
 * required: a mood maps to genres loosely.
 */
export function scoreRecommendCase(
  run: RecommendRun,
  expect: RecommendCase["expect"],
  mustNot: Set<number>,
): RecommendScore {
  const violations = run.picks.flatMap((pick) => checkPick(pick, expect, mustNot));
  // Shows that fit come first; near misses the grace allows only after them.
  const firstMiss = run.picks.findIndex((p) => nearMiss(p, expect));
  for (const pick of firstMiss < 0 ? [] : run.picks.slice(firstMiss + 1)) {
    if (!nearMiss(pick, expect)) {
      violations.push({
        animeId: pick.animeId,
        kind: "constraint",
        message: "fits the request but came after a show that's a little off",
      });
    }
  }
  const reasons: string[] = [];
  if (run.error) reasons.push(`error: ${run.error}`);
  if (!run.handedOff) reasons.push("never reached the recommender");
  if (expect.clarify) {
    if (run.picks.length > 0) reasons.push("picked shows instead of asking");
    else if (!run.reply.includes("?")) reasons.push("didn't ask");
  } else {
    if (expect.picks && run.picks.length === 0) reasons.push("no picks");
    if (!expect.picks && run.picks.length > 0) {
      reasons.push("picked shows when nothing should fit");
    }
  }
  if (violations.length > 0) reasons.push("picks break the labels");
  const wanted = expect.genres_any;
  return {
    correct: reasons.length === 0,
    reasons,
    violations,
    genreFit: wanted
      ? { fit: run.picks.filter((p) => fitsGenres(p, wanted)).length, total: run.picks.length }
      : null,
  };
}

export interface RecommendMetrics {
  cases: number;
  correct: number;
  handedOff: number;
  picks: number;
  /** Picks that could be recommended at all. */
  validPicks: number;
  /** Picks within every hard label. */
  withinLabels: number;
  genreFit: { fit: number; total: number };
  medianLatencyMs: number;
  p90LatencyMs: number;
  costPerCaseUsd: number | null;
  errors: number;
  inputTokens: number;
  outputTokens: number;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)] ?? 0;
}

export function aggregateRecommend(
  scored: { run: RecommendRun; score: RecommendScore }[],
): RecommendMetrics {
  const latencies = scored.map((s) => s.run.latencyMs).sort((a, b) => a - b);
  const costs = scored.map((s) => s.run.costUsd);
  const knownCosts = costs.filter((c): c is number => c !== null);
  /** Picks without a violation of this kind (or of any kind). */
  const clean = (kind?: Violation["kind"]) =>
    scored.reduce(
      (n, { run, score }) =>
        n +
        run.picks.filter(
          (pick) =>
            !score.violations.some(
              (v) => v.animeId === pick.animeId && (kind === undefined || v.kind === kind),
            ),
        ).length,
      0,
    );
  const genreFit = { fit: 0, total: 0 };
  for (const { score } of scored) {
    if (score.genreFit) {
      genreFit.fit += score.genreFit.fit;
      genreFit.total += score.genreFit.total;
    }
  }
  return {
    cases: scored.length,
    correct: scored.filter((s) => s.score.correct).length,
    handedOff: scored.filter((s) => s.run.handedOff).length,
    picks: scored.reduce((n, s) => n + s.run.picks.length, 0),
    validPicks: clean("invalid"),
    withinLabels: clean(),
    genreFit,
    medianLatencyMs: percentile(latencies, 0.5),
    p90LatencyMs: percentile(latencies, 0.9),
    // Unknown when any case's model has no price.
    costPerCaseUsd:
      knownCosts.length > 0 && knownCosts.length === costs.length
        ? knownCosts.reduce((sum, c) => sum + c, 0) / knownCosts.length
        : null,
    errors: scored.filter((s) => s.run.error !== null).length,
    inputTokens: scored.reduce((n, s) => n + s.run.inputTokens, 0),
    outputTokens: scored.reduce((n, s) => n + s.run.outputTokens, 0),
  };
}
