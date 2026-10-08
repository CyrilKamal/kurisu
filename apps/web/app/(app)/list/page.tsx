import { listResponseSchema, meResponseSchema } from "@kurisu/shared";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { apiGet } from "@/lib/api";
import { lastSyncLabel } from "@/lib/format";
import { readListView } from "@/lib/listFilters";

import { ListBrowser } from "./ListBrowser";
import { LogoutButton } from "./LogoutButton";
import { ResyncButton } from "./ResyncButton";
import { SyncBanner } from "./SyncBanner";

export const metadata: Metadata = { title: "My list · kurisu" };

export default async function ListPage(props: PageProps<"/list">) {
  const [me, list] = await Promise.all([
    apiGet("/me", meResponseSchema),
    apiGet("/list", listResponseSchema),
  ]);
  if (!me || !list) redirect("/");

  const initialView = readListView(await props.searchParams);

  return (
    <main className="mx-auto max-w-2xl px-4 pb-24">
      <ListBrowser
        entries={list.entries}
        initialView={initialView}
        header={
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
            <div className="min-w-0">
              <h1 className="text-lg font-semibold">My list</h1>
              <p className="truncate text-sm text-zinc-500">
                {me.user.malUsername} · {lastSyncLabel(list.lastSync)}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Link
                href="/list/brief"
                className="h-9 rounded-lg px-2 text-sm leading-9 text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-900"
              >
                Brief
              </Link>
              <Link
                href="/list/taste"
                className="h-9 rounded-lg px-2 text-sm leading-9 text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-900"
              >
                Taste
              </Link>
              <Link
                href="/list/import"
                className="h-9 rounded-lg px-2 text-sm leading-9 text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-900"
              >
                Import
              </Link>
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
        }
        banner={
          <SyncBanner
            needsReauth={me.needsReauth}
            lastSync={list.lastSync}
            hasEntries={list.entries.length > 0}
          />
        }
      />
    </main>
  );
}
