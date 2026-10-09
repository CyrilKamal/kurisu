"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { sendApi } from "@/lib/clientApi";

/** Ends a friendship, for both of you, after a confirm. */
export function RemoveFriend({ id, name }: { id: string; name: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function remove() {
    if (!window.confirm(`Remove ${name}? You'll stop seeing each other's activity.`)) return;
    setBusy(true);
    const result = await sendApi("DELETE", `/friends/${id}`, null);
    if (!result.ok && result.status !== 404) {
      setBusy(false);
      setMessage("Couldn't remove them. Try again.");
      return;
    }
    router.replace("/list/friends");
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
    </section>
  );
}
