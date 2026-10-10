import type { Metadata } from "next";

import { Banner } from "@/components/Banner";

import { OfflineList } from "./OfflineList";
import { TryAgain } from "./TryAgain";

export const metadata: Metadata = { title: "Offline · kurisu" };

/**
 * What the service worker shows when a page can't load: the list as this device last saw it,
 * read-only. Static, so it's saved ahead of time and needs no connection or session.
 */
export default function OfflinePage() {
  return (
    <main className="mx-auto max-w-(--content-max) px-4 pb-16">
      <header className="k-header">
        <div className="min-w-0 flex-1">
          <h1 className="k-header__title">Offline</h1>
          <p className="k-header__sub">no connection</p>
        </div>
        <div className="k-header__actions">
          <TryAgain />
        </div>
      </header>
      <Banner level="warn" className="mt-4">
        You&apos;re offline. Changes need a connection; your list is below as it last was.
      </Banner>
      <OfflineList />
    </main>
  );
}
