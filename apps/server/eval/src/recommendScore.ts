import type { ListStatus } from "@kurisu/shared";

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
  episodeMinutes: number | null;
  genres: string[];
  airingStatus: string | null;
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
    if (pick.episodeMinutes === null) constraint("episode length unknown");
    else if (pick.episodeMinutes > expect.max_episode_minutes) {
      constraint(
        `${String(pick.episodeMinutes)}-minute episodes, over ${String(expect.max_episode_minutes)}`,
      );
    }
  }
  const genres = new Set(pick.genres.map((g) => g.toLowerCase()));
  const unwanted = (expect.genres_none ?? []).filter((g) => genres.has(g.toLowerCase()));
  if (unwanted.length > 0) constraint(`has ${unwanted.join(", ")}`);
  const source = sourceProblem(pick, expect.source);
  if (source) constraint(source);
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
  const reasons: string[] = [];
  if (run.error) reasons.push(`error: ${run.error}`);
  if (!run.handedOff) reasons.push("never reached the recommender");
  if (expect.picks && run.picks.length === 0) reasons.push("no picks");
  if (!expect.picks && run.picks.length > 0) reasons.push("picked shows when nothing should fit");
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
