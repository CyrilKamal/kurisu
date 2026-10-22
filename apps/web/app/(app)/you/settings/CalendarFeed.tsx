"use client";

import { calendarResponseSchema, type CalendarResponse } from "@kurisu/shared";
import Link from "next/link";
import { useState } from "react";

import { useConfirm } from "@/components/Sheet";
import { sendApi } from "@/lib/clientApi";
import { relativeTime } from "@/lib/format";
import { googleCalendarUrl } from "@/lib/plans";

/**
 * The calendar feed (Pro): turn on a secret link, add it to Apple or Google Calendar in a tap or
 * copy it anywhere else, and replace it or turn it off. Without Pro it says what the plan adds.
 */
export function CalendarFeed({ initial }: { initial: CalendarResponse }) {
  const { confirm, sheet } = useConfirm();
  const [state, setState] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const { included, feed } = state;

  async function change(method: "POST" | "DELETE", failed: string) {
    setBusy(true);
    setMessage(null);
    const result = await sendApi(method, "/calendar", calendarResponseSchema);
    setBusy(false);
    if (result.ok && result.data) {
      setState(result.data);
      setCopied(false);
    } else {
      setMessage(failed);
    }
  }

  async function replace() {
    const yes = await confirm({
      title: "Make a new calendar link?",
      body: "Calendars subscribed to the old one stop updating. Add the new one to them again.",
      action: "New link",
    });
    if (yes) await change("POST", "Couldn't make a new link. Try again.");
  }

  async function turnOff() {
    const yes = await confirm({
      title: "Turn off the calendar?",
      body: "The link stops working, and calendars subscribed to it stop updating.",
      action: "Turn off",
      danger: true,
    });
    if (yes) await change("DELETE", "Couldn't turn it off. Try again.");
  }

  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      setMessage("Couldn't copy. Select the link and copy it yourself.");
    }
  }

  return (
    <section className="pt-6">
      <h2 className="k-title pb-2">Calendar</h2>
      <div className="k-panel flex flex-col gap-4 p-4">
        <p className="text-ink-muted">
          New episodes of the shows you&apos;re watching, and premieres on your Plan to Watch, in
          your own calendar app. It keeps itself up to date.
        </p>

        {!included && (
          <p className="k-field__hint">
            {feed
              ? "Your plan doesn't include the calendar now, so it's empty. "
              : "The calendar comes with Pro. "}
            <Link href="/you/plan" className="k-link">
              See plans
            </Link>
          </p>
        )}

        {included && !feed && (
          <div>
            <button
              type="button"
              className="k-btn k-btn--primary"
              disabled={busy}
              onClick={() => void change("POST", "Couldn't turn on the calendar. Try again.")}
            >
              Turn on the calendar
            </button>
          </div>
        )}

        {included && feed && (
          <>
            <div className="flex flex-wrap gap-2">
              <a href={feed.webcalUrl} className="k-btn k-btn--primary">
                Add to Apple Calendar
              </a>
              <a
                href={googleCalendarUrl(feed.webcalUrl)}
                target="_blank"
                rel="noopener noreferrer"
                className="k-btn"
              >
                Add to Google Calendar
              </a>
            </div>
            <div className="k-field">
              <label className="k-field__label" htmlFor="calendar-link">
                Or subscribe to this link in any calendar app
              </label>
              <div className="flex gap-2">
                <input
                  id="calendar-link"
                  className="k-input k-input--mono min-w-0 flex-1"
                  readOnly
                  value={feed.url}
                  onFocus={(e) => {
                    e.target.select();
                  }}
                />
                <button type="button" className="k-btn" onClick={() => void copy(feed.url)}>
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
              <p className="k-field__hint">
                {feed.lastFetchedAt
                  ? `A calendar app last fetched it ${relativeTime(feed.lastFetchedAt)}.`
                  : "No calendar app has fetched it yet."}{" "}
                Anyone with the link can see your episodes.
              </p>
            </div>
          </>
        )}

        {feed && (
          <p className="k-field__hint">
            {included && (
              <>
                <button
                  type="button"
                  className="k-link"
                  disabled={busy}
                  onClick={() => void replace()}
                >
                  New link
                </button>
                {" · "}
              </>
            )}
            <button type="button" className="k-link" disabled={busy} onClick={() => void turnOff()}>
              Turn off
            </button>
          </p>
        )}

        <p role="status" aria-live="polite" className="k-field__hint empty:hidden">
          {message}
        </p>
      </div>
      {sheet}
    </section>
  );
}
