import type { StatsResponse } from "@kurisu/shared";

import { Histogram, modeOf } from "@/components/Histogram";
import { Poster } from "@/components/Poster";
import { mediaTypeLabel } from "@/lib/format";
import { decadeLabel, showCount } from "@/lib/stats";

type Watched = StatsResponse["allTime"]["watched"];

/** A short ranked list: a name and how many shows. */
function Counted({ title, rows }: { title: string; rows: { name: string; shows: number }[] }) {
  if (rows.length === 0) return null;
  return (
    <div className="pt-6">
      <h3 className="k-caps">{title}</h3>
      <ul className="k-rows">
        {rows.map((row) => (
          <li
            key={row.name}
            className="flex justify-between gap-4 border-b border-line py-2 text-ink"
          >
            <span className="min-w-0 truncate">{row.name}</span>
            <span className="k-data-sm">{showCount(row.shows)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * What the user watches, over every show with an episode watched: studios and kinds (MAL's),
 * the decades they aired in, and the voices of their main characters (AniList's, for the shows
 * kurisu has looked up so far).
 */
export function WatchedStats({ watched }: { watched: Watched }) {
  if (watched.shows === 0) return null;
  const decadeMode = modeOf(watched.decades.map((d) => d.shows));
  return (
    <section className="pt-8">
      <h2 className="k-empty__title pb-2">What you watch</h2>
      <p className="k-field__hint">Across {showCount(watched.shows)} you&apos;ve watched.</p>

      {watched.decades.length > 1 && (
        <div className="pt-6">
          <h3 className="k-caps">When they aired</h3>
          <Histogram
            columns={watched.decades.map((d) => ({
              label: decadeLabel(d.decade),
              value: d.shows,
              name: `The ${decadeLabel(d.decade)}`,
            }))}
            modeIndex={decadeMode}
            summary={`Shows you watched by the decade they aired${
              decadeMode === null
                ? ""
                : `; most from the ${decadeLabel(watched.decades[decadeMode]?.decade ?? 0)}`
            }`}
          />
        </div>
      )}

      <Counted
        title="Studios"
        rows={watched.topStudios.map((s) => ({ name: s.studio, shows: s.shows }))}
      />
      <Counted
        title="Kinds of show"
        rows={watched.formats.map((f) => ({
          name: mediaTypeLabel(f.mediaType) ?? f.mediaType,
          shows: f.shows,
        }))}
      />

      {watched.voiceActors.length > 0 && (
        <div className="pt-6">
          <h3 className="k-caps">Voices you hear most</h3>
          <ul className="m-0 grid list-none gap-x-8 p-0 sm:grid-cols-2">
            {watched.voiceActors.map((voice) => (
              <li key={voice.name} className="flex items-center gap-2 border-b border-line py-2">
                <Poster url={voice.pictureUrl} title={voice.name} />
                <span className="min-w-0 flex-1 truncate text-ink">{voice.name}</span>
                <span className="k-data-sm">{showCount(voice.shows)}</span>
              </li>
            ))}
          </ul>
          {watched.castKnown < watched.shows && (
            <p className="k-field__hint pt-2">
              From the main characters&apos; Japanese voices in {showCount(watched.castKnown)} so
              far; kurisu looks up the rest from AniList after your next sync.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
