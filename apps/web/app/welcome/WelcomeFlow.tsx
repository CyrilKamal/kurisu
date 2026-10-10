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
import { postApi, sendApi } from "@/lib/clientApi";
import { useInstallState } from "@/lib/install";

import { Notifications } from "../(app)/you/settings/Notifications";

type Step = "install" | "brief" | "services";

/**
 * The first run (the design system's WelcomeStep): install kurisu, turn on the morning brief, and
 * pick your streaming services. Every step can be skipped. The end sends someone with an empty
 * list to Import, and everyone else to Today.
 */
export function WelcomeFlow({
  name,
  listSize,
  publicKey,
  initialSettings,
}: {
  name: string;
  listSize: number;
  publicKey: string | null;
  initialSettings: BriefSettingsResponse;
}) {
  const router = useRouter();
  const install = useInstallState();
  // Decided once, when the browser says whether kurisu is installed (opened from the Home
  // Screen: nothing to ask), so installing on the first step doesn't renumber the rest.
  const [decided, setDecided] = useState<Step[] | null>(null);
  if (decided === null && install !== null) {
    setDecided(install === "installed" ? ["brief", "services"] : ["install", "brief", "services"]);
  }
  const steps: Step[] = decided ?? ["install", "brief", "services"];
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

  async function finish() {
    setBusy(true);
    await postApi("/me/welcomed", welcomedResponseSchema);
    router.replace(listSize === 0 ? "/list/import" : "/today");
  }

  async function next(save?: BriefSettingsResponse) {
    setMessage(null);
    if (save) {
      setBusy(true);
      const saved = await saveSettings(save);
      setBusy(false);
      if (!saved) return;
    }
    if (index + 1 >= steps.length) await finish();
    else setIndex(index + 1);
  }

  const count = `${String(Math.min(index, steps.length - 1) + 1)}/${String(steps.length)}`;
  const last = index + 1 >= steps.length;
  const doneLabel = last ? (listSize === 0 ? "Import my list" : "See what's out today") : "Next";

  return (
    <main className="k-step">
      <p className="k-step__count">{count}</p>

      {step === "install" && (
        <>
          <h1 className="k-step__title">Welcome, {name}. Put kurisu on your Home Screen</h1>
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
          <Notifications publicKey={publicKey} />
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
            // The brief step turns the brief on at the time picked; services save as picked.
            if (step === "brief") void next({ ...settings, enabled: true });
            else if (step === "services") void next(settings);
            else void next();
          }}
        >
          {doneLabel}
        </button>
        <button
          type="button"
          className="k-btn k-btn--ghost k-btn--block"
          disabled={busy}
          onClick={() => {
            if (last) void finish();
            else void next();
          }}
        >
          {last ? "Skip and finish" : "Skip"}
        </button>
      </div>
    </main>
  );
}
