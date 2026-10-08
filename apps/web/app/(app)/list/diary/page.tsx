import { diaryResponseSchema } from "@kurisu/shared";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { apiGet } from "@/lib/api";

import { DiaryTimeline } from "./DiaryTimeline";

export const metadata: Metadata = { title: "Diary · kurisu" };

/** What the user watched, day by day, with what they said about it. */
export default async function DiaryPage() {
  const diary = await apiGet("/diary", diaryResponseSchema);
  if (!diary) redirect("/");

  return (
    <main className="mx-auto max-w-2xl px-4 pb-24">
      <header className="flex items-center justify-between border-b border-zinc-200 py-3 dark:border-zinc-800">
        <h1 className="text-lg font-semibold">Diary</h1>
        <Link href="/list" className="text-sm text-zinc-600 hover:underline dark:text-zinc-400">
          Back to list
        </Link>
      </header>
      <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
        Your updates, day by day. When you say how you felt about a show with an update
        (&ldquo;finished frieren, that finale was insane&rdquo;), your words are kept here.
      </p>
      <DiaryTimeline initial={diary} />
    </main>
  );
}
