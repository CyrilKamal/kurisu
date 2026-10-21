import type { FavoriteShow } from "@kurisu/shared";
import Link from "next/link";

import { showHref } from "@/lib/airing";
import { mediaTypeLabel } from "@/lib/format";

import { Poster } from "./Poster";

/** Favorite shows as posters, in their owner's order: on You and on a friend's page. */
export function FavoriteShows({ favorites }: { favorites: FavoriteShow[] }) {
  return (
    <ul className="k-grid">
      {favorites.map((show) => (
        <li key={show.animeId} className="k-grid__item">
          <Link
            prefetch={false}
            href={showHref(show.animeId)}
            className="block text-ink no-underline"
          >
            <Poster url={show.pictureUrl} title={show.title} size="fill" />
            <p className="k-grid__cap">{show.title}</p>
            <p className="k-grid__sub">
              <span>{mediaTypeLabel(show.mediaType) ?? ""}</span>
              <span>{show.startDate?.slice(0, 4) ?? ""}</span>
            </p>
          </Link>
        </li>
      ))}
    </ul>
  );
}
