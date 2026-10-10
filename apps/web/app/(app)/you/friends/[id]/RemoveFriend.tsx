"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { useConfirm } from "@/components/Sheet";
import { sendApi } from "@/lib/clientApi";

/** Ends a friendship, for both of you, after a confirm. */
export function RemoveFriend({ id, name }: { id: string; name: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const { confirm, sheet } = useConfirm();

  async function remove() {
    const yes = await confirm({
      title: `Remove ${name}?`,
      body: "You'll both stop seeing each other's taste match and activity.",
      action: "Remove friend",
      danger: true,
    });
    if (!yes) return;
    setBusy(true);
    const result = await sendApi("DELETE", `/friends/${id}`, null);
    if (!result.ok && result.status !== 404) {
      setBusy(false);
      setMessage("Couldn't remove them. Try again.");
      return;
    }
    router.replace("/you/friends");
    router.refresh();
  }

  return (
    <section className="pt-8">
      <button
        type="button"
        className="k-btn k-btn--danger"
        onClick={() => void remove()}
        disabled={busy}
      >
        Remove friend
      </button>
      <p role="status" aria-live="polite" className="k-field__hint pt-2 empty:hidden">
        {message}
      </p>
      {sheet}
    </section>
  );
}
