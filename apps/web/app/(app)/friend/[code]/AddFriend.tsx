"use client";

import { friendAddedSchema } from "@kurisu/shared";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { postApi } from "@/lib/clientApi";

export function AddFriend({ code }: { code: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function add() {
    setBusy(true);
    const result = await postApi("/friends", friendAddedSchema, { code });
    if (!result.ok || !result.data) {
      setBusy(false);
      setMessage(
        result.ok || result.status !== 404
          ? "Couldn't add them. Try again."
          : "This link doesn't work any more. Ask them for their new one.",
      );
      return;
    }
    router.replace(`/list/friends/${result.data.friendId}`);
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        className="k-btn k-btn--primary self-start"
        onClick={() => void add()}
        disabled={busy}
        aria-busy={busy}
      >
        {busy ? "Adding…" : "Add friend"}
      </button>
      <p role="status" aria-live="polite" className="k-field__hint empty:hidden">
        {message}
      </p>
    </div>
  );
}
