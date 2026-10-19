"use client";

import { useState } from "react";

/** Shares the year's summary with the phone's share sheet, or copies it where there's none. */
export function ShareYear({ text }: { text: string }) {
  const [status, setStatus] = useState<string | null>(null);

  async function share() {
    setStatus(null);
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ text });
        return;
      } catch (err) {
        // Closing the share sheet isn't a failure.
        if ((err as Error).name === "AbortError") return;
      }
    }
    try {
      await navigator.clipboard.writeText(text);
      setStatus("Copied. Paste it anywhere.");
    } catch {
      setStatus("Couldn't share or copy it here.");
    }
  }

  return (
    <div className="flex items-center gap-4">
      <button type="button" className="k-btn" onClick={() => void share()}>
        Share
      </button>
      <p role="status" aria-live="polite" className="k-field__hint empty:hidden">
        {status}
      </p>
    </div>
  );
}
