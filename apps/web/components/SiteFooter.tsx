import Link from "next/link";

/** The public pages' footer: the legal pages, how to reach kurisu, and who it isn't. */
export function SiteFooter({ contactEmail }: { contactEmail: string | null }) {
  return (
    <footer className="mx-auto flex max-w-(--content-max) flex-col gap-2 border-t border-line px-4 py-6">
      <nav aria-label="About kurisu" className="flex flex-wrap gap-x-4 gap-y-2">
        <Link className="k-link" href="/terms">
          Terms
        </Link>
        <Link className="k-link" href="/privacy">
          Privacy
        </Link>
        <Link className="k-link" href="/refunds">
          Refunds
        </Link>
        {contactEmail && (
          <a className="k-link" href={`mailto:${contactEmail}`}>
            {contactEmail}
          </a>
        )}
      </nav>
      <p className="k-field__hint">
        kurisu isn&apos;t affiliated with or endorsed by MyAnimeList or AniList.
      </p>
    </footer>
  );
}
