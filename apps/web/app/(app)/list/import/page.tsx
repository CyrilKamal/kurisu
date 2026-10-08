import { latestImportResponseSchema } from "@kurisu/shared";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { apiGet } from "@/lib/api";

import { ImportFlow } from "./ImportFlow";

export const metadata: Metadata = { title: "Import · kurisu" };

/** Import a list from your notes: paste, review everything, then one Import tap. */
export default async function ImportPage() {
  const latest = await apiGet("/imports/latest", latestImportResponseSchema);
  if (!latest) redirect("/");

  return (
    <main className="mx-auto max-w-2xl px-4 pb-40">
      <header className="flex items-center justify-between border-b border-zinc-200 py-3 dark:border-zinc-800">
        <h1 className="text-lg font-semibold">Import from your notes</h1>
        <Link href="/list" className="text-sm text-zinc-600 hover:underline dark:text-zinc-400">
          Back to list
        </Link>
      </header>
      <ImportFlow initial={latest.import} />
    </main>
  );
}
