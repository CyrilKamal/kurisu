"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { useConfirm } from "@/components/Sheet";
import { sendApi } from "@/lib/clientApi";
import { forgetPushOnThisBrowser } from "@/lib/pushDevice";

/** Deletes the account after a confirming sheet. MAL is never touched. */
export function DeleteAccount() {
  const router = useRouter();
  const { confirm, sheet } = useConfirm();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function remove() {
    const yes = await confirm({
      title: "Delete your kurisu data?",
      body: "Everything kurisu holds about you goes, for good. Your MyAnimeList list stays exactly as it is.",
      action: "Delete everything",
      danger: true,
    });
    if (!yes) return;
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
        <button
          type="button"
          className="k-btn k-btn--danger self-start"
          onClick={() => void remove()}
          disabled={busy}
          aria-busy={busy}
        >
          {busy ? "Deleting…" : "Delete my kurisu data"}
        </button>
        <p role="status" aria-live="polite" className="k-field__hint empty:hidden">
          {message}
        </p>
      </div>
      {sheet}
    </section>
  );
}
