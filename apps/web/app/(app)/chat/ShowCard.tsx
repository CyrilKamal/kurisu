import type { ShowCard as ShowCardData } from "@kurisu/shared";
import Image from "next/image";

import { showDetails } from "@/lib/format";

/** A show's cover, or a blank of the same size. */
export function Cover({ url }: { url: string | null }) {
  return url ? (
    <Image
      src={url}
      alt=""
      width={40}
      height={56}
      className="h-14 w-10 shrink-0 rounded bg-zinc-200 object-cover dark:bg-zinc-800"
    />
  ) : (
    <div aria-hidden className="h-14 w-10 shrink-0 rounded bg-zinc-200 dark:bg-zinc-800" />
  );
}

const CARD =
  "flex w-full items-start gap-3 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-left text-sm dark:border-zinc-800 dark:bg-zinc-900";

/**
 * A show the agent (or a brief) named. When the reply asks the user to choose, the card is a
 * button that answers with the show's exact title. Otherwise a show that isn't on the list can
 * have an Add button, which asks Chat to add it (and Chat then asks to confirm, as every add does).
 */
export function ShowCard({
  show,
  onChoose,
  onAdd,
}: {
  show: ShowCardData;
  onChoose?: () => void;
  onAdd?: () => void;
}) {
  const body = (title: React.ReactNode, below?: React.ReactNode) => (
    <>
      <Cover url={show.pictureUrl} />
      <div className="min-w-0">
        {title}
        <p className="text-xs text-zinc-500">{showDetails(show)}</p>
        {below}
      </div>
    </>
  );

  if (onChoose) {
    return (
      <button
        type="button"
        onClick={onChoose}
        aria-label={`Choose ${show.title}`}
        className={`${CARD} hover:border-blue-700 hover:bg-blue-50 dark:hover:border-blue-400 dark:hover:bg-zinc-800`}
      >
        {body(<p className="line-clamp-2 font-medium leading-snug">{show.title}</p>)}
      </button>
    );
  }
  return (
    <div className={CARD}>
      {body(
        <a
          href={`https://myanimelist.net/anime/${String(show.animeId)}`}
          target="_blank"
          rel="noopener noreferrer"
          className="line-clamp-2 font-medium leading-snug hover:underline"
        >
          {show.title}
        </a>,
        onAdd && (
          <button
            type="button"
            onClick={onAdd}
            className="mt-2 h-8 rounded-md border border-zinc-300 px-2.5 text-xs font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            Add to Plan to Watch
          </button>
        ),
      )}
    </div>
  );
}
