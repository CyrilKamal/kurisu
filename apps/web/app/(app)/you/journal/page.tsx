import { journalResponseSchema } from "@kurisu/shared";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { ScreenHeader } from "@/components/ScreenHeader";
import { apiGet } from "@/lib/api";

import { JournalTimeline } from "./JournalTimeline";

export const metadata: Metadata = { title: "Journal · kurisu" };

/** Every update to the list, wherever it was made, with Undo and what you said about it. */
export default async function JournalPage() {
  const journal = await apiGet("/journal", journalResponseSchema);
  if (!journal) redirect("/");
  return (
    <main className="mx-auto max-w-(--content-max) px-4 pb-nav">
      <ScreenHeader
        title="Journal"
        sub="kurisu, MyAnimeList and your imports, newest first"
        back="/you"
      />
      <JournalTimeline initial={journal} />
    </main>
  );
}
