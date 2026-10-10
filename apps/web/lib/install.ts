"use client";

import { useSyncExternalStore } from "react";

/** Chrome's install prompt event, which TypeScript's DOM types don't include yet. */
interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export type InstallState =
  /** Running from the Home Screen or as an installed app. */
  | "installed"
  /** The browser offered its install prompt (Chrome, Edge, Android). */
  | "promptable"
  /** iPhone or iPad Safari: installed by hand, from Share. */
  | "ios"
  /** Nothing to offer: the browser has no prompt, or already used it. */
  | "unavailable";

let deferred: InstallPromptEvent | null = null;
let installedNow = false;
const listeners = new Set<() => void>();
const notify = () => {
  for (const listener of listeners) listener();
};

/**
 * Starts listening for the browser's install prompt. The event fires once, early, so this runs
 * from the root layout (ServiceWorker) rather than from the screens that offer Install.
 */
export function listenForInstall(): () => void {
  const onPrompt = (event: Event) => {
    event.preventDefault();
    deferred = event as InstallPromptEvent;
    notify();
  };
  const onInstalled = () => {
    deferred = null;
    installedNow = true;
    notify();
  };
  window.addEventListener("beforeinstallprompt", onPrompt);
  window.addEventListener("appinstalled", onInstalled);
  return () => {
    window.removeEventListener("beforeinstallprompt", onPrompt);
    window.removeEventListener("appinstalled", onInstalled);
  };
}

function currentState(): InstallState {
  const standalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  if (standalone || installedNow) return "installed";
  if (deferred) return "promptable";
  if (/iPad|iPhone|iPod/.test(navigator.userAgent)) return "ios";
  return "unavailable";
}

/** Whether kurisu can be installed here, and how; null while rendering on the server. */
export function useInstallState(): InstallState | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    currentState,
    () => null,
  );
}

/** Shows the browser's install prompt; true when the user installed kurisu. */
export async function promptInstall(): Promise<boolean> {
  const event = deferred;
  if (!event) return false;
  deferred = null;
  await event.prompt();
  const { outcome } = await event.userChoice;
  if (outcome === "accepted") installedNow = true;
  notify();
  return outcome === "accepted";
}
