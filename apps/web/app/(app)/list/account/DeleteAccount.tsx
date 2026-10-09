"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { sendApi } from "@/lib/clientApi";
import { forgetPushOnThisBrowser } from "@/lib/pushDevice";

/** Deletes the account after one confirming tap. MAL is never touched. */
export function DeleteAccount() {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function remove() {
    setBusy(true);
    setMessage(null);
    const result = await sendApi("DELETE", "/me", null);
    if (!result.ok) {
      setBusy(false);
      setMessage("Couldn't delete your data. Nothing was deleted; try again.");
      return;
    }
    await forgetPushOnThisBrowser(false);
    router.replace("/");
    router.refresh();
  }

  return (
    <section className="pt-6">
      <h2 className="k-caps pb-2">Your data</h2>
      <div className="k-panel flex flex-col gap-4 p-4">
        <p className="text-ink-muted">
          Deleting removes everything kurisu holds about you: its copy of your list, your chats,
          History, diary, taste, stats and settings. Your MyAnimeList list stays exactly as it is.
          It can&apos;t be undone.
        </p>
        {confirming ? (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="k-btn k-btn--primary"
              onClick={() => void remove()}
              disabled={busy}
              aria-busy={busy}
            >
              {busy ? "Deleting…" : "Delete everything"}
            </button>
            <button
              type="button"
              className="k-btn k-btn--ghost"
              onClick={() => {
                setConfirming(false);
              }}
              disabled={busy}
            >
              Keep my data
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="k-btn k-btn--danger self-start"
            onClick={() => {
              setConfirming(true);
            }}
          >
            Delete my kurisu data
          </button>
        )}
        <p role="status" aria-live="polite" className="k-field__hint empty:hidden">
          {message}
        </p>
      </div>
    </section>
  );
}
