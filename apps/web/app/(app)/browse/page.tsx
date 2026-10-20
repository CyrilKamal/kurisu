import {
  scheduleResponseSchema,
  searchResponseSchema,
  seasonChartResponseSchema,
  TOP_CHARTS,
  topChartResponseSchema,
  type TopChart,
} from "@kurisu/shared";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { ScreenHeader } from "@/components/ScreenHeader";
import { apiGet } from "@/lib/api";

import { ScheduleView } from "./ScheduleView";
import { SearchView } from "./SearchView";
import { SeasonsView } from "./SeasonsView";
import { TopView } from "./TopView";

export const metadata: Metadata = { title: "Browse · kurisu" };

const TABS = [
  ["schedule", "Schedule"],
  ["seasons", "Seasons"],
  ["top", "Top"],
  ["search", "Search"],
] as const;
type Tab = (typeof TABS)[number][0];

const SUBS: Record<Tab, string> = {
  schedule: "what airs this week",
  seasons: "each season's most popular",
  top: "AniList's charts",
  search: "all anime, from AniList",
};

/** "2027-WINTER" when it's a season's URL form, else null for the current season. */
function seasonParam(value: string | string[] | undefined): string | null {
  return typeof value === "string" && /^\d{4}-(WINTER|SPRING|SUMMER|FALL)$/.test(value)
    ? value
    : null;
}

/** A Top chart's name from the URL, trending by default. */
function chartParam(value: string | string[] | undefined): TopChart {
  return TOP_CHARTS.find((chart) => chart === value) ?? "trending";
}

/**
 * Browse: what's airing this week (Schedule), each season's chart back to 1960 and next season
 * (Seasons), AniList's Top charts (Top) and AniList's search (Search). Each tab is its own URL,
 * loaded on the server.
 */
export default async function BrowsePage(props: PageProps<"/browse">) {
  const params = await props.searchParams;
  const tab: Tab = TABS.find(([key]) => key === params.tab)?.[0] ?? "schedule";

  return (
    <main className="mx-auto max-w-(--content-max) px-4 pb-nav">
      <ScreenHeader title="Browse" sub={SUBS[tab]} />
      <nav aria-label="Browse">
        <ul className="k-tabs">
          {TABS.map(([key, label]) => (
            <li key={key}>
              <Link
                href={`/browse?tab=${key}`}
                aria-current={key === tab ? "page" : undefined}
                className="k-tab"
                replace
              >
                {label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <BrowseTab tab={tab} season={seasonParam(params.season)} chart={chartParam(params.chart)} />
    </main>
  );
}

async function BrowseTab({
  tab,
  season,
  chart,
}: {
  tab: Tab;
  season: string | null;
  chart: TopChart;
}) {
  if (tab === "schedule") {
    const data = await apiGet("/browse/schedule", scheduleResponseSchema);
    if (!data) redirect("/");
    return <ScheduleView data={data} />;
  }
  if (tab === "seasons") {
    const path = season === null ? "/browse/seasons" : `/browse/seasons?season=${season}`;
    const data = await apiGet(path, seasonChartResponseSchema);
    if (!data) redirect("/");
    // A new season starts its own wait for AniList.
    return <SeasonsView key={data.season} data={data} />;
  }
  if (tab === "top") {
    const data = await apiGet(`/browse/top?chart=${chart}`, topChartResponseSchema);
    if (!data) redirect("/");
    return <TopView data={data} />;
  }
  // With no words, the server lists this season's popular shows, from its own data.
  const found = await apiGet("/search", searchResponseSchema);
  if (!found) redirect("/");
  return <SearchView season={found.results} />;
}
