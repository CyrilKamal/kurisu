import { meResponseSchema } from "@kurisu/shared";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { ScreenHeader } from "@/components/ScreenHeader";
import { apiGet } from "@/lib/api";

import { LogoutButton } from "../LogoutButton";
import { DeleteAccount } from "./DeleteAccount";

export const metadata: Metadata = { title: "Account · kurisu" };

/** Who you're logged in as, logging out, and deleting everything kurisu holds about you. */
export default async function AccountPage() {
  const me = await apiGet("/me", meResponseSchema);
  if (!me) redirect("/");

  return (
    <main className="mx-auto max-w-(--content-max) px-4 pb-16">
      <ScreenHeader
        title="Account"
        sub={`${me.user.malUsername} on MyAnimeList`}
        actions={
          <Link href="/list" className="k-btn k-btn--ghost">
            Back to list
          </Link>
        }
      />
      <section className="pt-6">
        <h2 className="k-caps pb-2">This device</h2>
        <div className="k-panel flex items-center justify-between gap-4 p-4">
          <p className="text-ink-muted">
            Logging out also stops this browser&apos;s notifications.
          </p>
          <LogoutButton />
        </div>
      </section>
      <DeleteAccount />
    </main>
  );
}
