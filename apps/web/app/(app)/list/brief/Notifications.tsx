"use client";

import { pushSubscriptionResponseSchema, pushTestResponseSchema } from "@kurisu/shared";
import { useEffect, useState } from "react";

import { postApi, sendApi } from "@/lib/clientApi";

type State =
  | "checking"
  | "unsupported"
  /** iPhone or iPad Safari, not added to the Home Screen: push only works once it is. */
  | "needs_install"
  | "blocked"
  | "off"
  | "on";

/** This device's push notifications: turn them on or off, and send a test. */
export function Notifications({ publicKey }: { publicKey: string | null }) {
  const [state, setState] = useState<State>("checking");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      setState(await currentState());
    })();
  }, []);

  async function turnOn() {
    if (!publicKey) return;
    setBusy(true);
    setMessage(null);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "blocked" : "off");
        return;
      }
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: base64UrlToBytes(publicKey),
      });
      const result = await sendApi(
        "POST",
        "/push/subscriptions",
        pushSubscriptionResponseSchema,
        subscription.toJSON(),
      );
      if (!result.ok) {
        await subscription.unsubscribe();
        setMessage(
          result.error === "unsupported_push_service"
            ? "This browser's push service isn't supported yet."
            : "Couldn't turn on notifications. Try again.",
        );
        return;
      }
      setState("on");
    } catch {
      setMessage("Couldn't turn on notifications in this browser.");
    } finally {
      setBusy(false);
    }
  }

  async function turnOff() {
    setBusy(true);
    setMessage(null);
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        await sendApi("DELETE", "/push/subscriptions", pushSubscriptionResponseSchema, {
          endpoint: subscription.endpoint,
        });
        await subscription.unsubscribe();
      }
      setState("off");
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setBusy(true);
    setMessage(null);
    const result = await postApi("/push/test", pushTestResponseSchema);
    setBusy(false);
    if (result.ok) {
      setMessage("Sent. It should show up in a few seconds.");
    } else {
      setMessage(
        result.error === "too_soon" ? "You can send one test a minute." : "Couldn't send a test.",
      );
    }
  }

  return (
    <section className="pt-6">
      <h2 className="k-caps pb-2">Notifications on this device</h2>
      <div className="k-panel p-4">
        {publicKey === null ? (
          <p className="text-ink-muted">
            Push isn&apos;t set up on the server yet (VAPID keys are missing).
          </p>
        ) : (
          <StateView
            state={state}
            busy={busy}
            onTurnOn={turnOn}
            onTurnOff={turnOff}
            onTest={test}
          />
        )}
        <p role="status" aria-live="polite" className="k-field__hint pt-2 empty:hidden">
          {message}
        </p>
      </div>
    </section>
  );
}

function StateView(props: {
  state: State;
  busy: boolean;
  onTurnOn: () => Promise<void>;
  onTurnOff: () => Promise<void>;
  onTest: () => Promise<void>;
}) {
  switch (props.state) {
    case "checking":
      return <p className="text-ink-faint">Checking…</p>;
    case "unsupported":
      return <p>This browser can&apos;t show push notifications.</p>;
    case "needs_install":
      return (
        <p>
          On iPhone and iPad, notifications only work from the Home Screen app. Tap Share, then
          &ldquo;Add to Home Screen&rdquo;, and open kurisu from there.
        </p>
      );
    case "blocked":
      return (
        <p>Notifications are blocked for this site. Allow them in your browser&apos;s settings.</p>
      );
    case "off":
      return (
        <div className="flex flex-wrap items-center justify-between gap-4">
          <p>Off on this device.</p>
          <Button onClick={props.onTurnOn} disabled={props.busy} primary>
            Turn on notifications
          </Button>
        </div>
      );
    case "on":
      return (
        <div className="flex flex-wrap items-center justify-between gap-4">
          <p>On for this device.</p>
          <div className="flex gap-2">
            <Button onClick={props.onTest} disabled={props.busy}>
              Send a test
            </Button>
            <Button onClick={props.onTurnOff} disabled={props.busy}>
              Turn off
            </Button>
          </div>
        </div>
      );
  }
}

export function Button(props: {
  onClick: () => Promise<void>;
  disabled: boolean;
  primary?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={() => void props.onClick()}
      disabled={props.disabled}
      aria-busy={props.disabled}
      className={props.primary ? "k-btn k-btn--primary" : "k-btn"}
    >
      {props.children}
    </button>
  );
}

async function currentState(): Promise<State> {
  const supported =
    "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  if (!supported) {
    const iOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    const standalone = window.matchMedia("(display-mode: standalone)").matches;
    return iOS && !standalone ? "needs_install" : "unsupported";
  }
  if (Notification.permission === "denied") return "blocked";
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  return subscription && Notification.permission === "granted" ? "on" : "off";
}

/** VAPID keys come base64url-encoded; the Push API wants bytes. */
function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const base64 = (value + "=".repeat((4 - (value.length % 4)) % 4))
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const raw = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}
