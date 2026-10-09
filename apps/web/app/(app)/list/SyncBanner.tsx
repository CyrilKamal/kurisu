import type { LastSync } from "@kurisu/shared";

import { Banner } from "@/components/Banner";
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
      <Banner
        level="warn"
        className="mt-4"
        // Full navigation: the server redirects to MAL's consent page.
        action={
          <a href="/api/auth/mal/login" className="k-link">
            Log in again
          </a>
        }
      >
        MyAnimeList needs you to log in again to keep your list in sync.
      </Banner>
    );
  }

  if (lastSync?.status === "failed") {
    return (
      <Banner level="info" className="mt-4">
        The last sync failed: {syncErrorMessage(lastSync.error)}{" "}
        {hasEntries ? "Showing your list from the previous sync." : "Try Re-sync in a minute."}
      </Banner>
    );
  }

  return null;
}
