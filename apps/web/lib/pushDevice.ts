import { pushSubscriptionResponseSchema } from "@kurisu/shared";

import { sendApi } from "./clientApi";

export type PushState =
  | "checking"
  | "unsupported"
  /** iPhone or iPad Safari, not added to the Home Screen: push only works once it is. */
  | "needs_install"
  | "blocked"
  | "off"
  | "on";

/** Whether this browser can show push notifications, and whether they're on for this account. */
export async function pushState(): Promise<PushState> {
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

/**
 * Asks for permission and subscribes this browser, unless it can't (`state` says why) or it's
 * already on. `message` explains a failure the state doesn't.
 */
export async function turnOnPush(
  publicKey: string,
): Promise<{ state: PushState; message: string | null }> {
  try {
    const now = await pushState();
    if (now !== "off") return { state: now, message: null };
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      return { state: permission === "denied" ? "blocked" : "off", message: null };
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
      return {
        state: "off",
        message:
          result.error === "unsupported_push_service"
            ? "This browser's push service isn't supported yet."
            : "Couldn't turn on notifications. Try again.",
      };
    }
    return { state: "on", message: null };
  } catch {
    return { state: "off", message: "Couldn't turn on notifications in this browser." };
  }
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

/**
 * Stops push on this browser for the account leaving it (logging out, deleting the account), so
 * a shared browser doesn't keep getting someone else's briefs. `tellServer` while still logged
 * in; a deleted account's subscriptions are already gone. Never throws: leaving must still work.
 */
export async function forgetPushOnThisBrowser(tellServer: boolean): Promise<void> {
  try {
    if (!("serviceWorker" in navigator)) return;
    const registration = await navigator.serviceWorker.getRegistration();
    const subscription = await registration?.pushManager.getSubscription();
    if (!subscription) return;
    if (tellServer) {
      await sendApi("DELETE", "/push/subscriptions", null, { endpoint: subscription.endpoint });
    }
    await subscription.unsubscribe();
  } catch {
    // Push may be blocked or unsupported here; there's nothing to forget then.
  }
}
