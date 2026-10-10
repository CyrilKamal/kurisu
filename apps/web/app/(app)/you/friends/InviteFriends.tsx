"use client";

import { createdInviteSchema, invitesResponseSchema, type InviteView } from "@kurisu/shared";
import { useState } from "react";

import { getApi, postApi, sendApi } from "@/lib/clientApi";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Makes invite links, shows each new one once to copy, and lists the latest with their fate. */
export function InviteFriends({ initial }: { initial: InviteView[] }) {
  const [invites, setInvites] = useState(initial);
  const [note, setNote] = useState("");
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function refresh() {
    const result = await getApi("/invites", invitesResponseSchema);
    if (result.ok) setInvites(result.data.invites);
  }

  async function create() {
    setBusy(true);
    setMessage(null);
    setCopied(false);
    const result = await postApi("/invites", createdInviteSchema, note ? { note } : {});
    setBusy(false);
    if (!result.ok || !result.data) {
      setMessage("Couldn't make an invite. Try again.");
      return;
    }
    setLink(result.data.url);
    setNote("");
    await refresh();
  }

  async function copy() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      setMessage("Couldn't copy. Select the link and copy it yourself.");
    }
  }

  async function revoke(id: string) {
    const result = await sendApi("DELETE", `/invites/${id}`, null);
    if (!result.ok) setMessage("Couldn't revoke that invite.");
    await refresh();
  }

  return (
    <>
      <section className="pt-6">
        <h2 className="k-caps pb-2">New invite</h2>
        <form
          className="k-panel flex flex-col gap-4 p-4"
          onSubmit={(e) => {
            e.preventDefault();
            void create();
          }}
        >
          <div className="k-field">
            <label className="k-field__label" htmlFor="invite-note">
              Who it&apos;s for
            </label>
            <input
              id="invite-note"
              className="k-input"
              maxLength={60}
              placeholder="Alex"
              value={note}
              onChange={(e) => {
                setNote(e.target.value);
              }}
            />
            <p className="k-field__hint">Only you see this, to tell your links apart.</p>
          </div>
          <button type="submit" className="k-btn k-btn--primary self-start" disabled={busy}>
            {busy ? "Making…" : "Invite a friend"}
          </button>

          {link && (
            <div className="k-field">
              <label className="k-field__label" htmlFor="invite-link">
                Their link
              </label>
              <div className="flex gap-2">
                <input
                  id="invite-link"
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
                Send it to them now: kurisu keeps only a fingerprint of it, so it can&apos;t show it
                again.
              </p>
            </div>
          )}
          <p role="status" aria-live="polite" className="k-field__hint empty:hidden">
            {message}
          </p>
        </form>
      </section>

      {invites.length > 0 && (
        <section className="pt-6">
          <h2 className="k-caps pb-2">Your invites</h2>
          <ul className="k-rows">
            {invites.map((invite) => (
              <li
                key={invite.id}
                className="flex items-center justify-between gap-4 border-b border-line py-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-ink">{invite.note ?? "No note"}</p>
                  <p className="k-field__hint">{statusLabel(invite)}</p>
                </div>
                {invite.status === "open" && (
                  <button
                    type="button"
                    className="k-btn k-btn--danger k-btn--sm"
                    onClick={() => void revoke(invite.id)}
                  >
                    Revoke
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

function statusLabel(invite: InviteView): string {
  switch (invite.status) {
    case "used":
      return invite.usedBy ? `Joined as ${invite.usedBy}` : "Used; that account was since deleted";
    case "expired":
      return "Expired";
    case "open": {
      const days = Math.max(1, Math.ceil((Date.parse(invite.expiresAt) - Date.now()) / DAY_MS));
      return `Open, ${String(days)} ${days === 1 ? "day" : "days"} left`;
    }
  }
}
