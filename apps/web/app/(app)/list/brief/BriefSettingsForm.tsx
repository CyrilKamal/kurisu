"use client";

import {
  briefSettingsResponseSchema,
  briefTestResponseSchema,
  STREAMING_SERVICES,
  type BriefSettingsResponse,
} from "@kurisu/shared";
import { useState, useSyncExternalStore } from "react";

import { postApi, sendApi } from "@/lib/clientApi";

import { Button } from "./Notifications";

/** Brief time and streaming services, plus "send me one now". */
export function BriefSettingsForm({ initial }: { initial: BriefSettingsResponse }) {
  const [settings, setSettings] = useState(initial);
  // What was last saved, which the status line describes (not unsaved edits).
  const [saved, setSaved] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const timeZone = useBrowserTimeZone();

  async function save() {
    setBusy(true);
    setMessage(null);
    const { enabled, time, services, sundayRecap } = settings;
    const result = await sendApi("PUT", "/brief/settings", briefSettingsResponseSchema, {
      enabled,
      time,
      services,
      sundayRecap,
      timeZone: timeZone ?? settings.timeZone,
    });
    setBusy(false);
    if (result.ok && result.data) {
      setSettings(result.data);
      setSaved(result.data);
      setMessage("Saved.");
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
          : `Sent ${sentText(result.data.episodes, result.data.started, result.data.recap)}. It's in Chat too.`,
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

        <label className="flex items-start gap-2">
          <input
            type="checkbox"
            checked={settings.sundayRecap}
            onChange={(e) => {
              setSettings((s) => ({ ...s, sundayRecap: e.target.checked }));
            }}
            className="mt-0.5 size-4"
          />
          <span>
            Sunday recap
            <span className="block text-zinc-500">
              On Sundays the brief also sums up your week, with your goal for the year.
            </span>
          </span>
        </label>

        {timeZone && <ScheduleStatus saved={saved} />}

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

const noSubscription = () => () => undefined;

/**
 * The browser's time zone; the brief time is local to it. Null while rendering on the server,
 * which may be in another zone.
 */
function useBrowserTimeZone(): string | null {
  return useSyncExternalStore(
    noSubscription,
    () => Intl.DateTimeFormat().resolvedOptions().timeZone,
    () => null,
  );
}

/** "Next brief: today at 4:50 PM" and what happened to the last one. */
function ScheduleStatus({ saved }: { saved: BriefSettingsResponse }) {
  const next =
    saved.next === null
      ? "The brief is off."
      : `Next brief: ${saved.next} at ${formatTime(saved.time)}.`;
  const last = saved.lastDaily;
  return (
    <div className="rounded-md bg-zinc-50 px-3 py-2 text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
      <p>{next}</p>
      {last && (
        <p className="mt-1 text-zinc-500">
          Last brief ({formatDate(last.localDate)}): {lastBriefText(last)}
        </p>
      )}
    </div>
  );
}

/** "3 new episodes", "1 show that started airing", "your week's recap", or a few of them. */
function sentText(episodes: number, started: number, recap: boolean): string {
  const parts = [
    episodes > 0 ? `${String(episodes)} new episode${episodes === 1 ? "" : "s"}` : null,
    started > 0 ? `${String(started)} show${started === 1 ? "" : "s"} that started airing` : null,
    recap ? "your week's recap" : null,
  ].filter((p) => p !== null);
  if (parts.length === 0) return "0 new episodes";
  const last = parts.pop() ?? "";
  return parts.length > 0 ? `${parts.join(", ")} and ${last}` : last;
}

function lastBriefText(last: NonNullable<BriefSettingsResponse["lastDaily"]>): string {
  switch (last.status) {
    case "sent":
      return `sent ${sentText(last.episodes, last.started, last.recap)}.`;
    case "empty":
      return "nothing new had aired, so nothing was sent.";
    case "skipped_late":
      return "skipped, because its time had passed long before (the server was off, or the time was set later).";
    case "failed":
      return "couldn't be sent yet. It will retry.";
    case "building":
    case "ready":
      return "being sent.";
  }
}

/** "16:50" in the browser's format, e.g. "4:50 PM". */
function formatTime(time: string): string {
  const [hours, minutes] = time.split(":").map(Number);
  return new Date(2000, 0, 1, hours, minutes).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

/** "2026-10-05" as "today", or e.g. "Mon, Oct 5". */
function formatDate(localDate: string): string {
  const today = new Intl.DateTimeFormat("en-CA").format(new Date());
  if (localDate === today) return "today";
  return new Date(`${localDate}T12:00:00`).toLocaleDateString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
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
