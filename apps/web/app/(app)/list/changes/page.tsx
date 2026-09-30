import { changesResponseSchema } from "@kurisu/shared";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { apiGet } from "@/lib/api";

import { ChangeLog } from "./ChangeLog";

export const metadata: Metadata = { title: "History · kurisu" };

/** Every write the agent made to MAL, newest first, each undoable. */
export default async function ChangesPage() {
  const log = await apiGet("/changes", changesResponseSchema);
  if (!log) redirect("/");

  return (
    <main className="mx-auto max-w-2xl px-4 pb-24">
      <header className="flex items-center justify-between border-b border-zinc-200 py-3 dark:border-zinc-800">
        <h1 className="text-lg font-semibold">History</h1>
        <Link href="/list" className="text-sm text-zinc-600 hover:underline dark:text-zinc-400">
          Back to list
        </Link>
      </header>
      <ChangeLog initialChanges={log.changes} />
    </main>
  );
}
