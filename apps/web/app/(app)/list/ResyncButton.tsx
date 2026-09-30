"use client";

import { syncErrorResponseSchema } from "@kurisu/shared";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

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
        onClick={() => void resync()}
        disabled={busy}
        className="h-9 rounded-lg border border-zinc-300 px-3 text-sm font-medium hover:bg-zinc-100 disabled:opacity-60 dark:border-zinc-700 dark:hover:bg-zinc-900"
      >
        {busy ? "Syncing…" : "Re-sync"}
      </button>
      {/* Floats under the button so a message never reflows the sticky header. */}
      <p
        role="status"
        aria-live="polite"
        className="absolute right-0 top-full z-20 mt-1 w-56 rounded-md bg-zinc-900 px-2 py-1.5 text-xs text-white shadow-lg empty:hidden dark:bg-zinc-100 dark:text-zinc-900"
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
