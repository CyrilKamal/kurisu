import type { LastSync } from "@kurisu/shared";

import { syncErrorMessage } from "@/lib/format";

export function SyncBanner({
  needsReauth,
  lastSync,
  hasEntries,
}: {
  needsReauth: boolean;
  lastSync: LastSync | null;
  hasEntries: boolean;
}) {
  if (needsReauth) {
    return (
      <div
        role="alert"
        className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100"
      >
        <span>MyAnimeList needs you to log in again to keep your list in sync.</span>
        {/* Full navigation: the server redirects to MAL's consent page. */}
        <a href="/api/auth/mal/login" className="font-medium underline">
          Log in again
        </a>
      </div>
    );
  }

  if (lastSync?.status === "failed") {
    return (
      <p
        role="status"
        className="mt-4 rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-sm text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300"
      >
        The last sync failed: {syncErrorMessage(lastSync.error)}{" "}
        {hasEntries ? "Showing your list from the previous sync." : "Try Re-sync in a minute."}
      </p>
    );
  }

  return null;
}
