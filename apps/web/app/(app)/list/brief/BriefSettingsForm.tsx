"use client";

import {
  briefSettingsSchema,
  briefTestResponseSchema,
  STREAMING_SERVICES,
  type BriefSettings,
} from "@kurisu/shared";
import { useState } from "react";

import { postApi, sendApi } from "@/lib/clientApi";

import { Button } from "./Notifications";

/** Brief time and streaming services, plus "send me one now". */
export function BriefSettingsForm({ initial }: { initial: BriefSettings }) {
  const [settings, setSettings] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  // The browser knows the user's time zone; the brief time is local to it.
  const [timeZone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone);

  async function save() {
    setBusy(true);
    setMessage(null);
    const result = await sendApi("PUT", "/brief/settings", briefSettingsSchema, {
      ...settings,
      timeZone,
    });
    setBusy(false);
    if (result.ok && result.data) {
      setSettings(result.data);
      setMessage(
        result.data.enabled
          ? `Saved. Your brief comes at ${result.data.time}.`
          : "Saved. The brief is off.",
      );
    } else {
      setMessage("Couldn't save. Check the time and try again.");
    }
  }

  async function sendNow() {
    setBusy(true);
    setMessage(null);
    const result = await postApi("/brief/test", briefTestResponseSchema);
    setBusy(false);
    if (result.ok && result.data) {
      setMessage(
        result.data.status === "empty"
          ? "Nothing new aired in the last 24 hours, so there's nothing to send."
          : `Sent ${String(result.data.episodes)} new episode${result.data.episodes === 1 ? "" : "s"}. It's in Chat too.`,
      );
    } else if (!result.ok) {
      setMessage(sendNowError(result.error));
    }
  }

  const toggleService = (id: (typeof STREAMING_SERVICES)[number]["id"]) => {
    setSettings((s) => ({
      ...s,
      services: s.services.includes(id) ? s.services.filter((x) => x !== id) : [...s.services, id],
    }));
  };

  return (
    <section className="mt-6">
      <h2 className="text-sm font-semibold">Brief</h2>
      <div className="mt-2 flex flex-col gap-4 rounded-lg border border-zinc-200 p-3 text-sm dark:border-zinc-800">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={settings.enabled}
            onChange={(e) => {
              setSettings((s) => ({ ...s, enabled: e.target.checked }));
            }}
            className="size-4"
          />
          Send me a morning brief
        </label>

        <label className="flex flex-wrap items-center gap-2">
          <span>Time</span>
          <input
            type="time"
            value={settings.time}
            onChange={(e) => {
              setSettings((s) => ({ ...s, time: e.target.value }));
            }}
            className="h-9 rounded-lg border border-zinc-300 bg-transparent px-2 dark:border-zinc-700"
          />
          <span className="text-zinc-500">{timeZone}</span>
        </label>

        <fieldset>
          <legend>Services you subscribe to</legend>
          <p className="mt-1 text-zinc-500">
            The brief says where to watch only when a show is on one of these.
          </p>
          <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3">
            {STREAMING_SERVICES.map((service) => (
              <label key={service.id} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={settings.services.includes(service.id)}
                  onChange={() => {
                    toggleService(service.id);
                  }}
                  className="size-4"
                />
                {service.label}
              </label>
            ))}
          </div>
        </fieldset>

        <div className="flex flex-wrap gap-2">
          <Button onClick={save} disabled={busy} primary>
            Save
          </Button>
          <Button onClick={sendNow} disabled={busy}>
            Send a brief now
          </Button>
        </div>
        <p
          role="status"
          aria-live="polite"
          className="text-zinc-600 empty:hidden dark:text-zinc-400"
        >
          {message}
        </p>
      </div>
    </section>
  );
}

function sendNowError(error: string): string {
  switch (error) {
    case "too_soon":
      return "You can send one a minute.";
    case "anilist_unavailable":
      return "Couldn't reach AniList for airing times. Try again in a minute.";
    case "push_disabled":
      return "Push isn't set up on the server yet.";
    default:
      return "Couldn't send the brief.";
  }
}
