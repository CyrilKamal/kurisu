"use client";

import { syncErrorResponseSchema } from "@kurisu/shared";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Icon } from "@/components/Icon";

/** Asks the server to re-sync with MAL, then re-renders the page with the fresh mirror. */
export function ResyncButton() {
  const router = useRouter();
  const [syncing, setSyncing] = useState(false);
  const [refreshing, startRefresh] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const busy = syncing || refreshing;

  async function resync() {
    setSyncing(true);
    setMessage(null);
    try {
      const res = await fetch("/api/sync", {
        method: "POST",
        headers: { accept: "application/json" },
      });
      if (res.status === 401) {
        // Session expired: back to the login page.
        router.replace("/");
        return;
      }
      if (!res.ok) {
        const body = syncErrorResponseSchema.safeParse(await res.json().catch(() => null));
        setMessage(messageFor(body.success ? body.data : null));
      }
      // Success or failure, the page's "last synced" line and banners should reflect it.
      startRefresh(() => {
        router.refresh();
      });
    } catch {
      setMessage("Network error. Check your connection and try again.");
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="relative">
      <button
        type="button"
        className="k-btn"
        onClick={() => void resync()}
        disabled={busy}
        aria-busy={busy}
      >
        <Icon name="sync" />
        {busy ? "Syncing…" : "Re-sync"}
      </button>
      {/* Floats under the button so a message never reflows the header. */}
      <p
        role="status"
        aria-live="polite"
        className="k-panel k-field__hint absolute right-0 top-full z-20 mt-2 w-56 px-2 py-2 empty:hidden"
      >
        {message}
      </p>
    </div>
  );
}

function messageFor(
  body: { error: string; retryAfterSeconds?: number | undefined } | null,
): string {
  switch (body?.error) {
    case "cooldown":
      return `Synced recently. Try again in ${String(body.retryAfterSeconds ?? 60)}s.`;
    case "reauth_required":
      return "MyAnimeList needs you to log in again.";
    default:
      return "Couldn't reach MyAnimeList. Try again in a minute.";
  }
}
