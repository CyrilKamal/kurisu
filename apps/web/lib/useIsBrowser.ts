import { useSyncExternalStore } from "react";

const noSubscription = () => () => undefined;

/**
 * False while rendering on the server, true in the browser. For anything that depends on the
 * viewer's time zone (log times, "Today"), so the server's render never disagrees with theirs.
 */
export function useIsBrowser(): boolean {
  return useSyncExternalStore(
    noSubscription,
    () => true,
    () => false,
  );
}
