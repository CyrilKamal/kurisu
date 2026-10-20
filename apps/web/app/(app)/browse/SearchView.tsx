"use client";

import { searchResponseSchema, type SearchResult } from "@kurisu/shared";
import Link from "next/link";
import { useEffect, useState } from "react";

import { AddSheet } from "@/components/AddSheet";
import { Icon } from "@/components/Icon";
import { Poster } from "@/components/Poster";
import { showHref } from "@/lib/airing";
import { getApi } from "@/lib/clientApi";
import { useIsBrowser } from "@/lib/useIsBrowser";
import { mediaTypeLabel, STATUS_LABELS } from "@/lib/format";

/** Searches wait for a pause in typing, so each word isn't its own AniList request. */
const PAUSE_MS = 600;
const RECENT_KEY = "kurisu:recent-searches";
const RECENT_MAX = 6;

function readRecent(): string[] {
  try {
    const stored: unknown = JSON.parse(window.localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(stored) ? stored.filter((s): s is string => typeof s === "string") : [];
  } catch {
    return [];
  }
}

function remember(query: string): string[] {
  const next = [query, ...readRecent().filter((q) => q.toLowerCase() !== query.toLowerCase())];
  const kept = next.slice(0, RECENT_MAX);
  try {
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(kept));
  } catch {
    // Private windows can refuse storage; recent searches are only a convenience.
  }
  return kept;
}

function searchError(status: number): string {
  if (status === 429) return "That's a lot of searches. Try again in a minute.";
  if (status === 0) return "You're offline. Searching needs a connection.";
  return "AniList isn't answering. Try again in a moment.";
}

/**
 * Search & add: never a blank screen. Before you type, your recent searches (on this device)
 * and what's airing this season; then AniList's matches, each saying where it stands on your
 * list, or with Add.
 */
export function SearchView({ season }: { season: SearchResult[] }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Null until read from this device's storage, which only the browser has.
  const [recent, setRecent] = useState<string[] | null>(null);
  const inBrowser = useIsBrowser();
  const recentShown = recent ?? (inBrowser ? readRecent() : []);
  const [adding, setAdding] = useState<SearchResult | null>(null);
  // Shows added from this screen, until the next search.
  const [added, setAdded] = useState<Map<number, SearchResult["entry"]>>(new Map());

  const words = query.trim();
  const typing = words.length >= 2;
  useEffect(() => {
    if (!typing) return;
    let current = true;
    const timer = setTimeout(() => {
      setSearching(true);
      void getApi(`/search?q=${encodeURIComponent(words)}`, searchResponseSchema).then((result) => {
        if (!current) return;
        setSearching(false);
        if (result.ok) {
          setError(null);
          setResults(result.data.results);
          setAdded(new Map());
          setRecent(remember(words));
        } else {
          setError(searchError(result.status));
        }
      });
    }, PAUSE_MS);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [words, typing]);

  // Clearing the box goes back to this season, whatever the last search found.
  const found = typing ? results : null;
  const shown = found ?? season;

  return (
    <>
      <div className="k-search pt-4">
        <Icon name="search" />
        <input
          type="search"
          className="k-input pr-8"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
          }}
          placeholder="Search all anime"
          aria-label="Search all anime"
          autoComplete="off"
          enterKeyHint="search"
          // The one thing to do on this screen.
          autoFocus
        />
      </div>
      <p className="k-field__hint pt-2">
        Have a list in your notes?{" "}
        <Link href="/list/import" className="k-link">
          Import it
        </Link>
      </p>

      {!typing && recentShown.length > 0 && (
        <section className="pt-4">
          <h2 className="k-caps pb-2">Recent</h2>
          <div className="k-chips">
            {recentShown.map((q) => (
              <button
                key={q}
                type="button"
                className="k-chip"
                onClick={() => {
                  setQuery(q);
                }}
              >
                {q}
              </button>
            ))}
          </div>
        </section>
      )}

      {typing && error && (
        <p className="k-cmd__notice pt-4" role="alert">
          <span className="k-tag k-tag--word text-accent-text">Err</span>
          {error}
        </p>
      )}

      <section className="pt-6" aria-busy={searching}>
        <h2 className="k-caps pb-2">
          {searching ? "Searching…" : found === null ? "Airing this season" : "Results"}
        </h2>
        {shown.length === 0 ? (
          <p className="k-field__hint">
            {found === null
              ? "Nothing yet: this season's shows arrive after your next sync."
              : `Nothing on AniList for “${words}”.`}
          </p>
        ) : (
          <ul className="k-rows">
            {shown.map((show) => {
              const entry = added.get(show.animeId) ?? show.entry;
              const meta = [
                mediaTypeLabel(show.mediaType),
                show.year === null ? null : String(show.year),
                show.numEpisodes === null ? null : `${String(show.numEpisodes)} eps`,
              ].filter((part) => part !== null);
              return (
                <li key={show.animeId} className="k-row">
                  <Link
                    href={showHref(show.animeId)}
                    className="block"
                    tabIndex={-1}
                    aria-hidden="true"
                  >
                    <Poster url={show.pictureUrl} title={show.title} />
                  </Link>
                  <div className="k-row__main">
                    <Link className="k-row__title" href={showHref(show.animeId)}>
                      {show.title}
                    </Link>
                    <p className="k-row__meta">
                      {meta.length > 0 && <span>{meta.join(" · ")}</span>}
                      {show.titleEn && show.titleEn !== show.title && <span>{show.titleEn}</span>}
                    </p>
                  </div>
                  {entry ? (
                    <span className="k-field__hint whitespace-nowrap">
                      On your list · {STATUS_LABELS[entry.status]}
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="k-btn k-btn--sm"
                      aria-label={`Add ${show.title}`}
                      onClick={() => {
                        setAdding(show);
                      }}
                    >
                      <Icon name="plus" />
                      Add
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {adding && (
        <AddSheet
          show={adding}
          onClose={() => {
            setAdding(null);
          }}
          onAdded={(change) => {
            const status = change.after.status ?? "plan_to_watch";
            setAdded((current) =>
              new Map(current).set(change.animeId, {
                status,
                episodesWatched: change.after.episodesWatched ?? 0,
              }),
            );
          }}
        />
      )}
    </>
  );
}
