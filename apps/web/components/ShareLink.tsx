"use client";

import { useState } from "react";

/** Shares a link through the phone's share sheet, or copies it where there's none. */
export function ShareLink({ url, text, label }: { url: string; text: string; label: string }) {
  const [copied, setCopied] = useState<"no" | "yes" | "failed">("no");

  async function share() {
    // Desktop browsers often have no share sheet, whatever the DOM types say.
    const nav: Partial<Navigator> = navigator;
    if (nav.share) {
      try {
        await nav.share({ text, url });
      } catch {
        // Dismissed: nothing to do.
      }
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied("yes");
    } catch {
      setCopied("failed");
    }
  }

  return (
    <button type="button" className="k-btn" onClick={() => void share()}>
      {copied === "yes" ? "Link copied" : copied === "failed" ? "Couldn't copy the link" : label}
    </button>
  );
}
