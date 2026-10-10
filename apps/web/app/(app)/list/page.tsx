import { listResponseSchema, meResponseSchema } from "@kurisu/shared";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { ScreenHeader } from "@/components/ScreenHeader";
import { apiGet } from "@/lib/api";
import { lastSyncLabel } from "@/lib/format";
import { readListView } from "@/lib/listFilters";

import { ListBrowser } from "./ListBrowser";
import { ListMenu } from "./ListMenu";
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
                  <ListMenu />
                </>
              }
            />
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
