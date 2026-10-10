import Image from "next/image";

// `fill` takes its cell's width (PosterGrid); 160 is enough pixels for the widest cell.
const WIDTHS = { sm: 32, md: 64, lg: 96, fill: 160 } as const;

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
}: {
  url: string | null;
  title: string;
  size?: keyof typeof WIDTHS;
  /** Share of episodes watched (0–1), for a show in progress. */
  progress?: number | null;
}) {
  const width = WIDTHS[size];
  return (
    <span className={`k-poster k-poster--${size}`}>
      {url ? (
        <Image src={url} alt="" width={width} height={width * 1.5} />
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
