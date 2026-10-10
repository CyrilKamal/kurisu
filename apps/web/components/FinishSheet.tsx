"use client";

import {
  changeResponseSchema,
  showResponseSchema,
  statsResponseSchema,
  type ChangeView,
  type ShowResponse,
  type StatsResponse,
} from "@kurisu/shared";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, use, useCallback, useEffect, useState } from "react";

import { showHref } from "@/lib/airing";
import { getApi, sendApi } from "@/lib/clientApi";
import { finishes } from "@/lib/finish";
import { editErrorMessage } from "@/lib/editEntry";
import { durationLabel } from "@/lib/format";
import { notifyListChanged } from "@/lib/listChanged";
import { goalProgress } from "@/lib/stats";

import { Sheet } from "./Sheet";

const SCORES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

const FinishContext = createContext<(change: ChangeView) => void>(() => undefined);

/** Opens the "Finished" sheet for a change that completed a show. */
export function useFinish(): (change: ChangeView) => void {
  return use(FinishContext);
}

/**
 * Holds the one "Finished" sheet the signed-in screens can open. It belongs to the page it opened
 * on: following its "Next" link closes it.
 */
export function FinishProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [finished, setFinished] = useState<{
    animeId: number;
    title: string;
    path: string;
  } | null>(null);
  const open = useCallback(
    (change: ChangeView) => {
      if (finishes(change)) {
        setFinished({ animeId: change.animeId, title: change.title, path: pathname });
      }
    },
    [pathname],
  );
  return (
    <FinishContext value={open}>
      {children}
      {finished?.path === pathname && (
        <FinishSheet
          key={finished.animeId}
          show={finished}
          onClose={() => {
            setFinished(null);
          }}
        />
      )}
    </FinishContext>
  );
}

/**
 * The moment a show is finished: how much of it you watched, a score in one tap, this year's
 * goal filling by one, and the sequel to start if there is one. Nothing here is required; Done
 * closes it.
 */
export function FinishSheet({
  show,
  onClose,
}: {
  show: { animeId: number; title: string };
  onClose: () => void;
}) {
  return (
    <Sheet title={`Finished ${show.title}`} onClose={onClose}>
      <div className="k-sheet__body">
        <FinishDetails animeId={show.animeId} />
      </div>
      <div className="k-sheet__actions">
        <button type="button" className="k-btn k-btn--primary" onClick={onClose}>
          Done
        </button>
      </div>
    </Sheet>
  );
}

/** What the sheet (and Chat, under a write that finished a show) says about it. */
export function FinishDetails({ animeId }: { animeId: number }) {
  const router = useRouter();
  const [page, setPage] = useState<ShowResponse | null>(null);
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [score, setScore] = useState(0);
  const [saving, setSaving] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The goal meter starts one short and fills to the new count, the motion the system allows.
  const [filled, setFilled] = useState(false);

  useEffect(() => {
    let current = true;
    void Promise.all([
      getApi(`/shows/${String(animeId)}`, showResponseSchema),
      getApi("/stats", statsResponseSchema),
    ]).then(([shown, counted]) => {
      if (!current) return;
      if (shown.ok) {
        setPage(shown.data);
        setScore(shown.data.entry?.score ?? 0);
      }
      if (counted.ok) setStats(counted.data);
      requestAnimationFrame(() => {
        if (current) setFilled(true);
      });
    });
    return () => {
      current = false;
    };
  }, [animeId]);

  async function rate(next: number) {
    setSaving(next);
    setError(null);
    const result = await sendApi("POST", `/list/${String(animeId)}/edit`, changeResponseSchema, {
      score: next,
      requestId: crypto.randomUUID(),
    });
    setSaving(null);
    if (result.ok) {
      setScore(next);
      // The screen behind shows the new score too.
      router.refresh();
      notifyListChanged();
    } else if (result.error === "no_change") {
      setScore(next);
    } else {
      setError(editErrorMessage(result.error));
    }
  }

  const minutes =
    page?.show.numEpisodes != null && page.show.episodeMinutes !== null
      ? page.show.numEpisodes * page.show.episodeMinutes
      : null;
  const year = stats?.year;
  const progress = year?.goal != null ? goalProgress(year.completed, year.goal) : null;
  const before =
    year?.goal != null ? goalProgress(Math.max(0, year.completed - 1), year.goal) : null;
  const next = page?.sequels.find((s) => s.status === null);

  return (
    <>
      {page && (
        <p className="text-ink-muted">
          {page.show.numEpisodes === null
            ? "Every episode watched."
            : `${String(page.show.numEpisodes)} ${page.show.numEpisodes === 1 ? "episode" : "episodes"}`}
          {minutes !== null && ` · ${durationLabel(minutes)} watched`}
        </p>
      )}

      <div className="k-field">
        <span className="k-field__label" id={`rate-${String(animeId)}`}>
          Your score
        </span>
        <div className="k-chips" role="group" aria-labelledby={`rate-${String(animeId)}`}>
          {SCORES.map((value) => (
            <button
              key={value}
              type="button"
              className="k-chip k-num"
              aria-pressed={score === value}
              aria-busy={saving === value}
              disabled={saving !== null}
              onClick={() => void rate(value)}
            >
              {value}
            </button>
          ))}
        </div>
        {error && (
          <p className="k-field__hint text-danger" role="alert">
            {error}
          </p>
        )}
      </div>

      {year && (
        <div className="k-field">
          <span className="k-field__label">{year.year}</span>
          {progress && before ? (
            <div
              className="k-meter"
              role="meter"
              aria-valuemin={0}
              aria-valuemax={year.goal ?? 0}
              aria-valuenow={year.completed}
              aria-valuetext={progress.label}
            >
              <div className="k-meter__track">
                <div
                  className="k-meter__fill"
                  style={
                    {
                      "--p": `${String(filled ? progress.percent : before.percent)}%`,
                    } as React.CSSProperties
                  }
                />
              </div>
              <span className="k-meter__label">
                <b>{year.completed}</b>/{year.goal} this year
              </span>
            </div>
          ) : (
            <p className="text-ink-muted">
              {year.completed} {year.completed === 1 ? "show" : "shows"} finished this year.{" "}
              <Link href="/you/stats" className="k-link">
                Set a goal
              </Link>
            </p>
          )}
        </div>
      )}

      {next && (
        <p className="text-ink-muted">
          Next:{" "}
          <Link href={showHref(next.animeId)} className="k-link">
            {next.title}
          </Link>
          {next.startDate && ` (${next.startDate.slice(0, 4)})`}
        </p>
      )}
    </>
  );
}

/** Chat's version, under the reply whose write finished the show: the same, without a sheet. */
export function FinishInline({ animeId, title }: { animeId: number; title: string }) {
  return (
    <section className="k-panel mt-2 flex flex-col gap-4 p-4" aria-label={`Finished ${title}`}>
      <p className="k-sheet__title">Finished {title}</p>
      <FinishDetails animeId={animeId} />
    </section>
  );
}
