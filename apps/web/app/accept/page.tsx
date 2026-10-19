import { TERMS_VERSION } from "@kurisu/shared";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";

import { DeleteAccount } from "@/app/(app)/you/settings/DeleteAccount";
import { LogoutButton } from "@/app/(app)/you/settings/LogoutButton";
import { getMe } from "@/lib/api";

import { AcceptTerms } from "./AcceptTerms";

export const metadata: Metadata = { title: "Before you go on · kurisu" };

/** "October 19, 2026": when the terms last changed. */
const CHANGED_ON = new Date(`${TERMS_VERSION}T00:00:00Z`).toLocaleDateString("en-US", {
  month: "long",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

/**
 * Asked once of an account that hasn't accepted the current terms (one from before them, or after
 * they change): 18 or older, and the terms and privacy policy. Or log out, or delete everything.
 */
export default async function AcceptPage() {
  const me = await getMe();
  if (!me) redirect("/");
  if (me.termsAccepted) redirect("/today");

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-6 px-4 py-8">
      <Image src="/icons/192.png" alt="" width={48} height={48} loading="eager" />
      <div>
        <h1 className="font-serif text-2xl/8 font-semibold text-ink">Before you go on</h1>
        <p className="text-ink-muted">
          kurisu&apos;s{" "}
          <Link href="/terms" target="_blank" className="k-link">
            terms
          </Link>{" "}
          and{" "}
          <Link href="/privacy" target="_blank" className="k-link">
            privacy policy
          </Link>{" "}
          changed on <time dateTime={TERMS_VERSION}>{CHANGED_ON}</time>. To keep using kurisu,
          {` ${me.user.malUsername}`}, confirm you&apos;re 18 or older and accept them.
        </p>
      </div>
      <ul className="flex list-disc flex-col gap-2 pl-4 text-ink-muted">
        <li>Free, Premium and Pro plans, with monthly allowances. Your list never locks.</li>
        <li>kurisu is an AI and can make mistakes. Every change it makes can be undone.</li>
        <li>You can download or delete everything kurisu holds about you, at any time.</li>
      </ul>
      <AcceptTerms />
      <div className="flex items-center justify-between gap-4 border-t border-line pt-4">
        <p className="k-field__hint">Not now?</p>
        <LogoutButton />
      </div>
      <DeleteAccount />
    </main>
  );
}
