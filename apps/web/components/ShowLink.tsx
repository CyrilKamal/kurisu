import Link from "next/link";

import { showHref } from "@/lib/airing";

/** A show's title as a link to its page, in the title's own color. */
export function ShowLink({ animeId, children }: { animeId: number; children: React.ReactNode }) {
  return (
    <Link
      href={showHref(animeId)}
      className="text-inherit no-underline underline-offset-3 hover:underline"
    >
      {children}
    </Link>
  );
}
