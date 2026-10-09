"use client";

import { friendLinkResponseSchema, sharingResponseSchema } from "@kurisu/shared";
import { useState } from "react";

import { postApi, sendApi } from "@/lib/clientApi";

/** Your friend link to copy or replace, and whether friends see what you watch. */
export function FriendLink({
  initialLink,
  initialSharing,
}: {
  initialLink: string;
  initialSharing: boolean;
}) {
  const [link, setLink] = useState(initialLink);
  const [sharing, setSharing] = useState(initialSharing);
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
    if (!window.confirm("Make a new link? Anyone with the old one can't use it any more.")) return;
    setMessage(null);
    const result = await postApi("/friends/link/reset", friendLinkResponseSchema);
    if (result.ok && result.data) {
      setLink(result.data.link);
      setCopied(false);
    } else {
      setMessage("Couldn't make a new link. Try again.");
    }
  }

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
      <h2 className="k-caps pb-2">You</h2>
      <div className="k-panel flex flex-col gap-4 p-4">
        <div className="k-field">
          <label className="k-field__label" htmlFor="friend-link">
            Your friend link
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
        <div className="k-field">
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
            only your taste match. Diary notes stay private unless you share one on the Diary page.
          </p>
        </div>
        <p role="status" aria-live="polite" className="k-field__hint empty:hidden">
          {message}
        </p>
      </div>
    </section>
  );
}
