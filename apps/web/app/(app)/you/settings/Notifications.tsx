"use client";

import { pushSubscriptionResponseSchema, pushTestResponseSchema } from "@kurisu/shared";
import { useEffect, useState } from "react";

import { postApi, sendApi } from "@/lib/clientApi";
import { pushState, turnOnPush, type PushState } from "@/lib/pushDevice";

/** This device's push notifications: turn them on or off, and send a test. */
export function Notifications({ publicKey }: { publicKey: string | null }) {
  const [state, setState] = useState<PushState>("checking");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      setState(await pushState());
    })();
  }, []);

  async function turnOn() {
    if (!publicKey) return;
    setBusy(true);
    setMessage(null);
    const result = await turnOnPush(publicKey);
    setState(result.state);
    setMessage(result.message);
    setBusy(false);
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
      <h2 className="k-title pb-2">Notifications on this device</h2>
      <div className="k-panel p-4">
        {publicKey === null ? (
          <p className="text-ink-muted">Notifications aren&apos;t available on this server yet.</p>
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
  state: PushState;
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
