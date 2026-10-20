"use client";

import { alertsResponseSchema, type AlertsResponse } from "@kurisu/shared";
import Link from "next/link";
import { useState } from "react";

import { sendApi } from "@/lib/clientApi";

/**
 * Episode alerts (Premium and Pro): a push as each episode of a show you're watching comes out.
 * Without the plan it says what includes them; with them off after a plan change, they can still
 * be turned off.
 */
export function EpisodeAlerts({ initial }: { initial: AlertsResponse }) {
  const [state, setState] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const { included, on, muted } = state;

  async function turn(next: boolean) {
    setBusy(true);
    setMessage(null);
    const result = await sendApi("PUT", "/alerts", alertsResponseSchema, { on: next });
    setBusy(false);
    if (result.ok && result.data) setState(result.data);
    else setMessage("Couldn't change that. Try again.");
  }

  return (
    <section className="pt-6">
      <h2 className="k-caps pb-2">Episode alerts</h2>
      <div className="k-panel flex flex-col gap-2 p-4">
        <label className="k-switch">
          <input
            type="checkbox"
            role="switch"
            checked={on}
            disabled={busy || (!included && !on)}
            onChange={(e) => void turn(e.target.checked)}
          />
          Tell me as each episode comes out
        </label>
        <p className="k-field__hint">
          A notification for each new episode of a show you&apos;re watching, once AniList says
          it&apos;s out, with where it streams on your services. Tap it to open the show, where
          &ldquo;+1 ep&rdquo; is. You can mute a show on its page.
          {on && muted.length > 0 && ` ${String(muted.length)} muted.`}
        </p>
        {!included && (
          <p className="k-field__hint">
            {on
              ? "Your plan doesn't include episode alerts now, so none are sent. "
              : "Episode alerts come with Premium and Pro. "}
            <Link href="/you/plan" className="k-link">
              See plans
            </Link>
          </p>
        )}
        <p role="status" aria-live="polite" className="k-field__hint empty:hidden">
          {message}
        </p>
      </div>
    </section>
  );
}
