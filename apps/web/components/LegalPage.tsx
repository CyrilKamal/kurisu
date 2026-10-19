import Image from "next/image";
import Link from "next/link";

import { SiteFooter } from "@/components/SiteFooter";

/**
 * The frame of a public policy page (terms, privacy, refunds): the name linking home, the title
 * and when it last changed, then the text, set for reading.
 */
export function LegalPage({
  title,
  updated,
  contactEmail,
  children,
}: {
  title: string;
  /** ISO date of the last change. */
  updated: string;
  contactEmail: string | null;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-dvh bg-bg">
      <header className="mx-auto flex max-w-(--content-max) items-center gap-2 px-4 py-4">
        <Link href="/" className="flex items-center gap-2 text-ink">
          <Image src="/icons/192.png" alt="" width={24} height={24} />
          <span className="font-serif text-base/6 font-bold">kurisu</span>
        </Link>
      </header>
      <main className="mx-auto max-w-(--content-max) px-4 pb-12">
        <h1 className="font-serif text-2xl/8 font-semibold text-ink">{title}</h1>
        <p className="k-field__hint pb-6">
          Last updated <time dateTime={updated}>{updated}</time>
        </p>
        <div className="flex flex-col gap-4 text-ink-muted [&_h2]:pt-4 [&_h2]:font-serif [&_h2]:text-base/6 [&_h2]:font-semibold [&_h2]:text-ink [&_li]:pl-1 [&_strong]:text-ink [&_ul]:flex [&_ul]:list-disc [&_ul]:flex-col [&_ul]:gap-2 [&_ul]:pl-6">
          {children}
        </div>
      </main>
      <SiteFooter contactEmail={contactEmail} />
    </div>
  );
}
