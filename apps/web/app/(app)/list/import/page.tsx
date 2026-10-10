import { latestImportResponseSchema } from "@kurisu/shared";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { ScreenHeader } from "@/components/ScreenHeader";
import { apiGet } from "@/lib/api";

import { ImportFlow } from "./ImportFlow";

export const metadata: Metadata = { title: "Import · kurisu" };

/** Import a list from your notes: paste, review everything, then one Import tap. */
export default async function ImportPage() {
  const latest = await apiGet("/imports/latest", latestImportResponseSchema);
  if (!latest) redirect("/");

  return (
    <main className="mx-auto max-w-(--content-max) px-4 pb-40">
      <ScreenHeader title="Import" sub="from your notes: paste, review, one tap" back="/list" />
      <ImportFlow initial={latest.import} />
    </main>
  );
}
