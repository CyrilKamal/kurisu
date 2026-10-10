import { searchResponseSchema } from "@kurisu/shared";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { ScreenHeader } from "@/components/ScreenHeader";
import { apiGet } from "@/lib/api";

import { SearchView } from "./SearchView";

export const metadata: Metadata = { title: "Search · kurisu" };

/** Find any anime on AniList and add it to your list, without Chat. */
export default async function SearchPage() {
  // With no words, the server lists this season's popular shows, from its own data.
  const season = await apiGet("/search", searchResponseSchema);
  if (!season) redirect("/");
  return (
    <main className="mx-auto max-w-(--content-max) px-4 pb-nav">
      <ScreenHeader title="Search & add" sub="all anime, from AniList" back="/list" />
      <SearchView season={season.results} />
    </main>
  );
}
