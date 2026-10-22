"use client";

import {
  FAVORITES_MAX,
  favoritesResponseSchema,
  type FavoriteShow,
  type FavoritesResponse,
} from "@kurisu/shared";
import { useState } from "react";

import { FavoriteShows } from "@/components/FavoriteShows";
import { Icon } from "@/components/Icon";
import { Sheet, SheetClose } from "@/components/Sheet";
import { sendApi } from "@/lib/clientApi";
import { moved } from "@/lib/favorites";

/**
 * Your favorite shows (up to 10) on You, in your order, for friends to see. The heart on a show's
 * page adds one; Edit puts them in order or takes one off.
 */
export function Favorites({ initial }: { initial: FavoritesResponse }) {
  const [favorites, setFavorites] = useState(initial.favorites);
  const [editing, setEditing] = useState<FavoriteShow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function save(order: FavoriteShow[]) {
    setBusy(true);
    setMessage(null);
    // Taken off first, then the rest in their new order.
    for (const show of favorites) {
      if (order.some((s) => s.animeId === show.animeId)) continue;
      const removed = await sendApi(
        "DELETE",
        `/favorites/${String(show.animeId)}`,
        favoritesResponseSchema,
      );
      if (!removed.ok) {
        setBusy(false);
        setMessage("Couldn't save that. Try again.");
        return;
      }
    }
    const result = await sendApi("PUT", "/favorites", favoritesResponseSchema, {
      animeIds: order.map((show) => show.animeId),
    });
    setBusy(false);
    if (result.ok && result.data) {
      setFavorites(result.data.favorites);
      setEditing(null);
    } else {
      setMessage("Couldn't save that. Try again.");
    }
  }

  return (
    <section className="pt-6">
      <div className="flex items-baseline justify-between pb-2">
        <h2 className="k-caps">Favorites</h2>
        {favorites.length > 0 && (
          <button
            type="button"
            className="k-btn k-btn--ghost k-btn--sm"
            onClick={() => {
              setMessage(null);
              setEditing(favorites);
            }}
          >
            <Icon name="rename" />
            Edit
          </button>
        )}
      </div>
      {favorites.length === 0 ? (
        <p className="k-field__hint">
          Tap the heart on a show&apos;s page to add it here, up to {FAVORITES_MAX}. Friends see
          them on your page while you share what you watch.
        </p>
      ) : (
        <FavoriteShows favorites={favorites} />
      )}

      {editing && (
        <Sheet
          title="Your favorites"
          onClose={() => {
            setEditing(null);
          }}
          onSubmit={() => void save(editing)}
        >
          <div className="k-sheet__body">
            {editing.length === 0 ? (
              <p className="text-ink-muted">No favorites left. Save to take them all off.</p>
            ) : (
              <ol className="k-rows">
                {editing.map((show, i) => (
                  <li
                    key={show.animeId}
                    className="flex items-center gap-2 border-b border-line py-2"
                  >
                    <span className="k-data-sm w-6 text-ink-muted">{i + 1}</span>
                    <span className="min-w-0 flex-1 truncate text-ink">{show.title}</span>
                    <button
                      type="button"
                      className="k-btn k-btn--icon"
                      aria-label={`Move ${show.title} up`}
                      disabled={i === 0}
                      onClick={() => {
                        setEditing(moved(editing, i, -1));
                      }}
                    >
                      <Icon name="chevron-left" className="rotate-90" />
                    </button>
                    <button
                      type="button"
                      className="k-btn k-btn--icon"
                      aria-label={`Move ${show.title} down`}
                      disabled={i === editing.length - 1}
                      onClick={() => {
                        setEditing(moved(editing, i, 1));
                      }}
                    >
                      <Icon name="chevron-down" />
                    </button>
                    <button
                      type="button"
                      className="k-btn k-btn--icon"
                      aria-label={`Take ${show.title} off your favorites`}
                      onClick={() => {
                        setEditing(editing.filter((s) => s.animeId !== show.animeId));
                      }}
                    >
                      <Icon name="clear" />
                    </button>
                  </li>
                ))}
              </ol>
            )}
            {message && (
              <p className="k-field__hint" role="alert">
                {message}
              </p>
            )}
          </div>
          <div className="k-sheet__actions">
            <span className="flex-1" />
            <SheetClose>Cancel</SheetClose>
            <button type="submit" className="k-btn k-btn--primary" disabled={busy} aria-busy={busy}>
              {busy ? "Saving…" : "Save"}
            </button>
          </div>
        </Sheet>
      )}
    </section>
  );
}
