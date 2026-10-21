import Image from "next/image";

/**
 * How wide each poster is drawn, as an `<img sizes>`: the browser then fetches as many pixels as
 * the screen needs (96 for a small poster on a phone's 3x screen), not a fixed 1x/2x pair. A
 * `fill` poster takes its PosterGrid cell, a third of a phone's width or at most 160px. Small
 * posters are 48px from 1024px (app/globals.css).
 *
 * From 1024px each size is doubled: a desktop screen's 1x pixels would get a cover resized to
 * exactly its box, which blurs, and the browser draws twice the pixels shrunk much sharper.
 */
const SIZES = {
  sm: "(min-width: 1024px) 96px, 32px",
  md: "(min-width: 1024px) 128px, 64px",
  lg: "(min-width: 1024px) 192px, 96px",
  fill: "(max-width: 640px) 33vw, (min-width: 1024px) 320px, 160px",
} as const;

/**
 * A show's cover at 2:3 with a hairline edge (the design system's Poster): 32×48 in rows, the
 * log and the brief, 64×96 in picks. A show under way gets a crimson progress edge. With no
 * cover, the small poster shows the title's initial.
 */
export function Poster({
  url,
  title,
  size = "sm",
  progress = null,
  eager = false,
}: {
  url: string | null;
  title: string;
  size?: keyof typeof SIZES;
  /** Share of episodes watched (0–1), for a show in progress. */
  progress?: number | null;
  /** Load at once rather than when scrolled near: for covers at the top of a page. */
  eager?: boolean;
}) {
  return (
    <span className={`k-poster k-poster--${size}`}>
      {url ? (
        // The poster box sets the size (2:3, position relative), so the image fills it.
        <Image src={url} alt="" fill sizes={SIZES[size]} loading={eager ? "eager" : "lazy"} />
      ) : (
        <span className="k-poster__blank" data-initial={title.slice(0, 1).toUpperCase()}>
          {title}
        </span>
      )}
      {progress !== null && progress > 0 && (
        <span className="k-poster__progress" aria-hidden="true">
          <span
            style={
              {
                "--p": `${String(Math.round(Math.min(progress, 1) * 100))}%`,
              } as React.CSSProperties
            }
          />
        </span>
      )}
    </span>
  );
}

/** How far through a show someone is, for a poster's progress edge; null when unknown. */
export function progressOf(episodesWatched: number, numEpisodes: number | null): number | null {
  return numEpisodes ? episodesWatched / numEpisodes : null;
}
