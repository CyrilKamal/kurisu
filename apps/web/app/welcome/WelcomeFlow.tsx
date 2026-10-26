"use client";

import {
  briefSettingsResponseSchema,
  STREAMING_SERVICES,
  welcomedResponseSchema,
  type BriefSettingsResponse,
} from "@kurisu/shared";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { InstallPrompt } from "@/components/InstallPrompt";
import { ShareLink } from "@/components/ShareLink";
import { postApi, sendApi } from "@/lib/clientApi";
import { useInstallState } from "@/lib/install";
import { turnOnPush, type PushState } from "@/lib/pushDevice";

type Step = "hello" | "install" | "brief" | "services" | "done";

/**
 * The first run (the design system's WelcomeStep): what kurisu found (the list, and the friend who
 * invited them), install kurisu, turn on the morning brief with its notifications, and pick your
 * streaming services. The setup steps can be skipped. The end tries kurisu: Chat for a list, or
 * Import for an empty one.
 */
export function WelcomeFlow({
  name,
  listSize,
  publicKey,
  initialSettings,
  inviter,
  friendLink,
}: {
  name: string;
  listSize: number;
  publicKey: string | null;
  initialSettings: BriefSettingsResponse;
  /** Who invited them, with their taste match (null with too little in common). */
  inviter: { name: string; match: number | null } | null;
  friendLink: string;
}) {
  const router = useRouter();
  const install = useInstallState();
  // Decided once, when the browser says whether kurisu is installed (opened from the Home
  // Screen: nothing to ask), so installing on the first step doesn't renumber the rest.
  const [decided, setDecided] = useState<Step[] | null>(null);
  if (decided === null && install !== null) {
    setDecided(
      install === "installed"
        ? ["hello", "brief", "services", "done"]
        : ["hello", "install", "brief", "services", "done"],
    );
  }
  const steps: Step[] = decided ?? ["hello", "install", "brief", "services", "done"];
  const [index, setIndex] = useState(0);
  const step = steps[Math.min(index, steps.length - 1)] ?? "brief";
  const [settings, setSettings] = useState(initialSettings);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function saveSettings(next: BriefSettingsResponse): Promise<boolean> {
    const result = await sendApi("PUT", "/brief/settings", briefSettingsResponseSchema, {
      enabled: next.enabled,
      time: next.time,
      services: next.services,
      sundayRecap: next.sundayRecap,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });
    if (result.ok && result.data) {
      setSettings(result.data);
      return true;
    }
    setMessage("Couldn't save that. Try again, or skip it for now.");
    return false;
  }

  async function finish(to: "/list/import" | "/chat/new" | "/today") {
    setBusy(true);
    const done = await postApi("/me/welcomed", welcomedResponseSchema);
    // Unsaved, Today would only send them back here: stay, and say so.
    if (!done.ok) {
      setBusy(false);
      setMessage("Couldn't finish just now. Check your connection and try again.");
      return;
    }
    router.replace(to);
  }

  // The brief turns on at the time picked, and so do this device's notifications, which it needs.
  async function startBrief() {
    setMessage(null);
    setBusy(true);
    const saved = await saveSettings({ ...settings, enabled: true });
    const push = saved && publicKey ? await turnOnPush(publicKey) : null;
    setBusy(false);
    if (!saved) return;
    if (push && push.state !== "on") {
      setMessage(push.message ?? pushProblem(push.state));
      return;
    }
    setIndex(index + 1);
  }

  async function next(save?: BriefSettingsResponse) {
    setMessage(null);
    if (save) {
      setBusy(true);
      const saved = await saveSettings(save);
      setBusy(false);
      if (!saved) return;
    }
    if (index + 1 >= steps.length) await finish("/today");
    else setIndex(index + 1);
  }

  const count = `${String(Math.min(index, steps.length - 1) + 1)}/${String(steps.length)}`;
  const tryTo = listSize === 0 ? "/list/import" : "/chat/new";
  const primaryLabel =
    step === "done"
      ? listSize === 0
        ? "Import my list"
        : "Tell kurisu what you watched"
      : step === "brief"
        ? `Send my brief at ${settings.time}`
        : "Next";

  return (
    <main className="k-step">
      <p className="k-step__count">{count}</p>

      {step === "hello" && (
        <>
          <h1 className="k-step__title">Welcome, {name}. Your list is in</h1>
          <p className="k-step__text">
            {listSize === 0
              ? "Your MyAnimeList anime list is empty, so there's nothing to sync yet. At the end you can import one from your notes."
              : `${String(listSize)} ${listSize === 1 ? "show" : "shows"} from MyAnimeList. Tell kurisu what you watched and it updates MyAnimeList for you.`}
          </p>
          {inviter && (
            <p className="k-step__text">
              You and {inviter.name} are friends on kurisu
              {inviter.match === null ? "." : `, with a ${String(inviter.match)}% taste match.`}
            </p>
          )}
        </>
      )}

      {step === "install" && (
        <>
          <h1 className="k-step__title">Put kurisu on your Home Screen</h1>
          <p className="k-step__text">
            It opens like an app, and on iPhone it&apos;s the only way to get notifications.
          </p>
          <InstallPrompt
            onInstalled={() => {
              void next();
            }}
          />
        </>
      )}

      {step === "brief" && (
        <>
          <h1 className="k-step__title">A morning brief of what&apos;s new</h1>
          <p className="k-step__text">
            Once a day: new episodes of what you&apos;re watching, and premieres of shows you
            planned or sequels to ones you finished. Tap it to reply in Chat.
          </p>
          <div className="k-field">
            <label className="k-field__label" htmlFor="welcome-time">
              Send it at
            </label>
            <input
              id="welcome-time"
              type="time"
              value={settings.time}
              onChange={(e) => {
                setSettings((s) => ({ ...s, time: e.target.value }));
              }}
              className="k-input k-input--mono w-32"
            />
          </div>
        </>
      )}

      {step === "services" && (
        <>
          <h1 className="k-step__title">Where do you watch?</h1>
          <p className="k-step__text">
            The brief and recommendations name these when a show is on one, and never guess.
          </p>
          <fieldset className="k-field m-0 border-0 p-0">
            <legend className="k-field__label pb-2">Your services</legend>
            <div className="grid grid-cols-2 gap-x-4 gap-y-2">
              {STREAMING_SERVICES.map((service) => (
                <label key={service.id} className="k-check">
                  <input
                    type="checkbox"
                    checked={settings.services.includes(service.id)}
                    onChange={() => {
                      setSettings((s) => ({
                        ...s,
                        services: s.services.includes(service.id)
                          ? s.services.filter((x) => x !== service.id)
                          : [...s.services, service.id],
                      }));
                    }}
                  />
                  {service.label}
                </label>
              ))}
            </div>
          </fieldset>
        </>
      )}

      {step === "done" && (
        <>
          <h1 className="k-step__title">
            {listSize === 0 ? "Bring your list in" : "Try it: tell kurisu what you watched"}
          </h1>
          <p className="k-step__text">
            {listSize === 0
              ? "Paste what you've watched from your notes, in any format, and kurisu sorts it into your MyAnimeList list."
              : "Say it the way you would to a friend. kurisu updates MyAnimeList, and every change can be undone."}
          </p>
          <p className="k-step__text">Friends already on kurisu can add you with your link.</p>
          <ShareLink url={friendLink} text="Add me on kurisu" label="Share your friend link" />
        </>
      )}

      <p role="status" aria-live="polite" className="k-field__hint empty:hidden">
        {message}
      </p>

      <div className="k-step__actions">
        <button
          type="button"
          className="k-btn k-btn--primary k-btn--lg k-btn--block"
          disabled={busy}
          aria-busy={busy}
          onClick={() => {
            if (step === "brief") void startBrief();
            else if (step === "services") void next(settings);
            else if (step === "done") void finish(tryTo);
            else void next();
          }}
        >
          {primaryLabel}
        </button>
        {step !== "hello" && (
          <button
            type="button"
            className="k-btn k-btn--ghost k-btn--block"
            disabled={busy}
            onClick={() => {
              if (step === "done") void finish("/today");
              else void next();
            }}
          >
            {step === "done" ? "See what's out today" : "Skip"}
          </button>
        )}
      </div>
    </main>
  );
}

/** Why the brief can't reach this device yet, and what to do. */
function pushProblem(state: PushState): string {
  switch (state) {
    case "needs_install":
      return "On iPhone and iPad, notifications only work from the Home Screen app. Add kurisu there and turn them on in Settings, or skip for now.";
    case "blocked":
      return "Notifications are blocked for kurisu. Allow them in your browser's settings, or skip for now.";
    case "unsupported":
      return "This browser can't show notifications, so the brief can't reach you here. Skip for now.";
    default:
      return "The brief arrives as a notification, so kurisu needs your OK. Tap again to allow it, or skip for now.";
  }
}
