"use client";

import { friendLinkResponseSchema } from "@kurisu/shared";
import Link from "next/link";
import { useState } from "react";

import { useConfirm } from "@/components/Sheet";
import { postApi } from "@/lib/clientApi";

/** Your friend link to copy or replace. Whether friends see what you watch is in Settings. */
export function FriendLink({ initialLink }: { initialLink: string }) {
  const { confirm, sheet } = useConfirm();
  const [link, setLink] = useState(initialLink);
  const [copied, setCopied] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      setMessage("Couldn't copy. Select the link and copy it yourself.");
    }
  }

  async function reset() {
    const yes = await confirm({
      title: "Make a new link?",
      body: "Anyone with the old one can't use it any more.",
      action: "New link",
    });
    if (!yes) return;
    setMessage(null);
    const result = await postApi("/friends/link/reset", friendLinkResponseSchema);
    if (result.ok && result.data) {
      setLink(result.data.link);
      setCopied(false);
    } else {
      setMessage("Couldn't make a new link. Try again.");
    }
  }

  return (
    <section className="pt-6">
      <h2 className="k-caps pb-2">Your friend link</h2>
      <div className="k-panel flex flex-col gap-4 p-4">
        <div className="k-field">
          <label className="k-field__label" htmlFor="friend-link">
            Send it to someone on kurisu
          </label>
          <div className="flex gap-2">
            <input
              id="friend-link"
              className="k-input k-input--mono min-w-0 flex-1"
              readOnly
              value={link}
              onFocus={(e) => {
                e.target.select();
              }}
            />
            <button type="button" className="k-btn" onClick={() => void copy()}>
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <p className="k-field__hint">
            Anyone on kurisu who opens it can add you as a friend.{" "}
            <button type="button" className="k-link" onClick={() => void reset()}>
              New link
            </button>
          </p>
        </div>
        <p className="k-field__hint">
          What friends see of your watching is up to you, in{" "}
          <Link href="/you/settings" className="k-link">
            Settings
          </Link>
          .
        </p>
        <p role="status" aria-live="polite" className="k-field__hint empty:hidden">
          {message}
        </p>
      </div>
      {sheet}
    </section>
  );
}
