"use client";

import {
  waitlistInviteResponseSchema,
  waitlistResponseSchema,
  type WaitlistEntry,
} from "@kurisu/shared";
import { useState } from "react";

import { getApi, postApi, sendApi } from "@/lib/clientApi";

/**
 * For the owner: who asked for an invite on the landing page. Invite makes a one-time link for
 * that person (its note is their email) to copy and send; kurisu sends no email itself.
 */
export function Waitlist({ initial }: { initial: WaitlistEntry[] }) {
  const [entries, setEntries] = useState(initial);
  const [link, setLink] = useState<{ email: string; url: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function refresh() {
    const result = await getApi("/waitlist", waitlistResponseSchema);
    if (result.ok) setEntries(result.data.entries);
  }

  async function invite(entry: WaitlistEntry) {
    setBusy(entry.id);
    setMessage(null);
    setCopied(false);
    const result = await postApi(`/waitlist/${entry.id}/invite`, waitlistInviteResponseSchema);
    setBusy(null);
    if (!result.ok || !result.data) {
      setMessage("Couldn't make an invite. Try again.");
      return;
    }
    setLink({ email: entry.email, url: result.data.url });
    await refresh();
  }

  async function remove(entry: WaitlistEntry) {
    setBusy(entry.id);
    const result = await sendApi("DELETE", `/waitlist/${entry.id}`, null);
    setBusy(null);
    if (!result.ok) setMessage("Couldn't remove them. Try again.");
    await refresh();
  }

  async function copy() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link.url);
      setCopied(true);
    } catch {
      setMessage("Couldn't copy. Select the link and copy it yourself.");
    }
  }

  const waiting = entries.filter((e) => !e.invitedAt).length;
  return (
    <section className="pt-6">
      <h2 className="k-caps pb-2">
        Waitlist <span className="k-num text-ink-faint">{waiting}</span>
      </h2>
      {link && (
        <div className="k-field pb-4">
          <label className="k-field__label" htmlFor="waitlist-link">
            Invite for {link.email}
          </label>
          <div className="flex gap-2">
            <input
              id="waitlist-link"
              className="k-input k-input--mono min-w-0 flex-1"
              readOnly
              value={link.url}
              onFocus={(e) => {
                e.target.select();
              }}
            />
            <button type="button" className="k-btn" onClick={() => void copy()}>
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <p className="k-field__hint">
            Email it to them now: it works for a week, and kurisu can&apos;t show it again.
          </p>
        </div>
      )}
      {entries.length === 0 ? (
        <p className="k-field__hint">No one yet. The landing page&apos;s form adds people here.</p>
      ) : (
        <ul className="k-rows">
          {entries.map((entry) => (
            <li
              key={entry.id}
              className="flex items-center justify-between gap-4 border-b border-line py-2"
            >
              <div className="min-w-0">
                <p className="truncate text-ink">{entry.email}</p>
                <p className="k-field__hint">
                  {[
                    entry.malUsername,
                    `joined ${entry.createdAt.slice(0, 10)}`,
                    entry.invitedAt && `invited ${entry.invitedAt.slice(0, 10)}`,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>
              <div className="flex flex-none gap-2">
                <button
                  type="button"
                  className="k-btn k-btn--sm"
                  disabled={busy === entry.id}
                  onClick={() => void invite(entry)}
                >
                  {entry.invitedAt ? "New link" : "Invite"}
                </button>
                <button
                  type="button"
                  className="k-btn k-btn--danger k-btn--sm"
                  disabled={busy === entry.id}
                  onClick={() => void remove(entry)}
                >
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <p role="status" aria-live="polite" className="k-field__hint empty:hidden">
        {message}
      </p>
    </section>
  );
}
