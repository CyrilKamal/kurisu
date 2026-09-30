import {
  LIST_STATUSES,
  listResponseSchema,
  meResponseSchema,
  type ListStatus,
} from "@kurisu/shared";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { apiGet } from "@/lib/api";
import { countByStatus, lastSyncLabel, STATUS_LABELS } from "@/lib/format";

import { EntryRow } from "./EntryRow";
import { LogoutButton } from "./LogoutButton";
import { ResyncButton } from "./ResyncButton";
import { StatusTabs } from "./StatusTabs";
import { SyncBanner } from "./SyncBanner";

export const metadata: Metadata = { title: "My list · kurisu" };

function parseStatus(value: string | string[] | undefined): ListStatus {
  return LIST_STATUSES.find((status) => status === value) ?? "watching";
}

export default async function ListPage(props: PageProps<"/list">) {
  const [me, list] = await Promise.all([
    apiGet("/me", meResponseSchema),
    apiGet("/list", listResponseSchema),
  ]);
  if (!me || !list) redirect("/");

  const selected = parseStatus((await props.searchParams).status);
  const counts = countByStatus(list.entries);
  const visible = list.entries.filter((entry) => entry.status === selected);

  return (
    <main className="mx-auto max-w-2xl px-4 pb-24">
      <header className="sticky top-0 z-10 -mx-4 border-b border-zinc-200 bg-white/90 px-4 pt-3 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/90">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <div className="min-w-0">
            <h1 className="text-lg font-semibold">My list</h1>
            <p className="truncate text-sm text-zinc-500">
              {me.user.malUsername} · {lastSyncLabel(list.lastSync)}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/list/changes"
              className="h-9 rounded-lg px-2 text-sm leading-9 text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-900"
            >
              History
            </Link>
            <ResyncButton />
            <LogoutButton />
          </div>
        </div>
        <StatusTabs selected={selected} counts={counts} />
      </header>

      <SyncBanner
        needsReauth={me.needsReauth}
        lastSync={list.lastSync}
        hasEntries={list.entries.length > 0}
      />

      {visible.length > 0 ? (
        <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
          {visible.map((entry) => (
            <EntryRow key={entry.animeId} entry={entry} />
          ))}
        </ul>
      ) : (
        <p className="py-12 text-center text-sm text-zinc-500">
          {list.entries.length === 0
            ? "Your MyAnimeList anime list is empty."
            : `Nothing in ${STATUS_LABELS[selected]}.`}
        </p>
      )}
    </main>
  );
}
