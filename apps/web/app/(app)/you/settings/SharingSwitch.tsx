"use client";

import { sharingResponseSchema } from "@kurisu/shared";
import { useState } from "react";

import { sendApi } from "@/lib/clientApi";

/** Whether friends see what you watch. */
export function SharingSwitch({ initial }: { initial: boolean }) {
  const [sharing, setSharing] = useState(initial);
  const [message, setMessage] = useState<string | null>(null);

  async function share(next: boolean) {
    setMessage(null);
    setSharing(next);
    const result = await sendApi("PUT", "/friends/sharing", sharingResponseSchema, {
      shareActivity: next,
    });
    if (!result.ok) {
      setSharing(!next);
      setMessage("Couldn't change that. Try again.");
    }
  }

  return (
    <section className="pt-6">
      <h2 className="k-caps pb-2">Friends</h2>
      <div className="k-panel flex flex-col gap-2 p-4">
        <label className="k-switch">
          <input
            type="checkbox"
            role="switch"
            checked={sharing}
            onChange={(e) => void share(e.target.checked)}
          />
          Share what I watch with friends
        </label>
        <p className="k-field__hint">
          Episodes, finishes, scores and drops (never why you dropped something). Off, friends see
          only your taste match. Diary notes stay private unless you share one in your Diary.
        </p>
        <p role="status" aria-live="polite" className="k-field__hint empty:hidden">
          {message}
        </p>
      </div>
    </section>
  );
}
