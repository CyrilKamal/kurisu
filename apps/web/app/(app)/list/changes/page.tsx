import { changesResponseSchema } from "@kurisu/shared";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { ScreenHeader } from "@/components/ScreenHeader";
import { apiGet } from "@/lib/api";

import { ChangeLog } from "./ChangeLog";

export const metadata: Metadata = { title: "History · kurisu" };

/** Every write to MAL, by the agent, the user or an import, newest first, each undoable. */
export default async function ChangesPage() {
  const log = await apiGet("/changes", changesResponseSchema);
  if (!log) redirect("/");

  return (
    <main className="mx-auto max-w-(--content-max) px-4 pb-16">
      <ScreenHeader
        title="History"
        sub="every write to MyAnimeList, newest first"
        actions={
          <Link href="/list" className="k-btn k-btn--ghost">
            Back to list
          </Link>
        }
      />
      <ChangeLog initialChanges={log.changes} />
    </main>
  );
}
