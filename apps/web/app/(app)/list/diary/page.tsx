import { diaryResponseSchema } from "@kurisu/shared";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { ScreenHeader } from "@/components/ScreenHeader";
import { apiGet } from "@/lib/api";

import { DiaryTimeline } from "./DiaryTimeline";

export const metadata: Metadata = { title: "Diary · kurisu" };

/** What the user watched, day by day, with what they said about it. */
export default async function DiaryPage() {
  const diary = await apiGet("/diary", diaryResponseSchema);
  if (!diary) redirect("/");

  return (
    <main className="mx-auto max-w-(--content-max) px-4 pb-16">
      <ScreenHeader
        title="Diary"
        sub="your updates, day by day, in your words"
        actions={
          <Link href="/list" className="k-btn k-btn--ghost">
            Back to list
          </Link>
        }
      />
      <p className="k-field__hint py-4">
        When you say how you felt about a show with an update (&ldquo;finished frieren, that finale
        was insane&rdquo;), your words are kept here.
      </p>
      <DiaryTimeline initial={diary} />
    </main>
  );
}
