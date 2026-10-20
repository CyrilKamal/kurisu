"use client";

import { FAVORITES_MAX, favoritesResponseSchema } from "@kurisu/shared";
import { useState } from "react";

import { Icon } from "@/components/Icon";
import { sendApi } from "@/lib/clientApi";

/**
 * A show's heart: one of the user's favorites (up to 10, on their profile and for friends), or
 * not. Any show kurisu knows can be one, on the list or not.
 */
export function FavoriteButton({
  animeId,
  title,
  favorite: initial,
}: {
  animeId: number;
  title: string;
  favorite: boolean;
}) {
  const [favorite, setFavorite] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function toggle() {
    setBusy(true);
    setMessage(null);
    const result = await sendApi(
      favorite ? "DELETE" : "PUT",
      `/favorites/${String(animeId)}`,
      favoritesResponseSchema,
    );
    setBusy(false);
    if (result.ok && result.data) {
      setFavorite(result.data.favorites.some((show) => show.animeId === animeId));
    } else if (!result.ok && result.error === "favorites_full") {
      setMessage(`You have ${String(FAVORITES_MAX)} favorites. Take one off in You first.`);
    } else {
      setMessage("Couldn't change that. Try again.");
    }
  }

  return (
    <>
      <button
        type="button"
        className={favorite ? "k-btn k-btn--sm" : "k-btn k-btn--ghost k-btn--sm"}
        aria-pressed={favorite}
        aria-label={
          favorite ? `Take ${title} off your favorites` : `Add ${title} to your favorites`
        }
        disabled={busy}
        onClick={() => void toggle()}
      >
        <Icon name="heart" />
        {favorite ? "Favorite" : "Add to favorites"}
      </button>
      {message && (
        <p role="alert" className="k-field__hint w-full">
          {message}
        </p>
      )}
    </>
  );
}
