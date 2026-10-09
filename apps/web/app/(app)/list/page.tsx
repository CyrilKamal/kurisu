import { listResponseSchema, meResponseSchema } from "@kurisu/shared";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Icon, type IconName } from "@/components/Icon";
import { ScreenHeader } from "@/components/ScreenHeader";
import { apiGet } from "@/lib/api";
import { lastSyncLabel } from "@/lib/format";
import { readListView } from "@/lib/listFilters";

import { ListBrowser } from "./ListBrowser";
import { LogoutButton } from "./LogoutButton";
import { ResyncButton } from "./ResyncButton";
import { SyncBanner } from "./SyncBanner";

export const metadata: Metadata = { title: "My list · kurisu" };

/** The screens around the list, as ghost links under its header. */
const SECTIONS: { href: string; label: string; icon?: IconName }[] = [
  { href: "/list/brief", label: "Brief", icon: "bell" },
  { href: "/list/stats", label: "Stats" },
  { href: "/list/diary", label: "Diary" },
  { href: "/list/taste", label: "Taste", icon: "star" },
  { href: "/list/import", label: "Import", icon: "plus" },
  { href: "/list/changes", label: "History", icon: "undo" },
];

export default async function ListPage(props: PageProps<"/list">) {
  const [me, list] = await Promise.all([
    apiGet("/me", meResponseSchema),
    apiGet("/list", listResponseSchema),
  ]);
  if (!me || !list) redirect("/");

  const initialView = readListView(await props.searchParams);

  return (
    <main className="mx-auto max-w-(--content-max) px-4 pb-16">
      <ListBrowser
        entries={list.entries}
        initialView={initialView}
        header={
          <>
            <ScreenHeader
              title="My list"
              sub={`${me.user.malUsername} · ${String(list.entries.length)} entries · ${lastSyncLabel(list.lastSync).toLowerCase()}`}
              actions={
                <>
                  <ResyncButton />
                  <LogoutButton />
                </>
              }
            />
            <nav
              aria-label="List screens"
              className="-mx-4 flex gap-2 overflow-x-auto px-4 py-2 [scrollbar-width:none]"
            >
              {SECTIONS.map((section) => (
                <Link key={section.href} href={section.href} className="k-btn k-btn--ghost">
                  {section.icon && <Icon name={section.icon} />}
                  {section.label}
                </Link>
              ))}
            </nav>
          </>
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
