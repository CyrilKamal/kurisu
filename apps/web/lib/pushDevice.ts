import { sendApi } from "./clientApi";

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
